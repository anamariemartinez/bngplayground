#!/usr/bin/env tsx
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseBNGLWithANTLR, analyzeModelStiffness } from '../packages/engine/src';
import { validateModel } from '../packages/mcp-server/src/services/engine';

interface DiagnosticResult {
    model: string;
    parseSuccess: boolean;
    moleculeTypes: number;
    reactionRules: number;
    species: number;
    parameters: number;
    observables: number;
    stiffness: { category: string; ratio: number };
    warnings: string[];
    errors: string[];
}

function collectBnglFiles(dir: string, results: string[] = []): string[] {
    if (!existsSync(dir)) return results;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            collectBnglFiles(fullPath, results);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bngl')) {
            results.push(fullPath);
        }
    }
    return results;
}

function diagnoseModel(code: string): DiagnosticResult {
    const result: DiagnosticResult = {
        model: '',
        parseSuccess: false,
        moleculeTypes: 0,
        reactionRules: 0,
        species: 0,
        parameters: 0,
        observables: 0,
        stiffness: { category: 'unknown', ratio: 1 },
        warnings: [],
        errors: [],
    };

    try {
        const parseResult = parseBNGLWithANTLR(code);
        result.parseSuccess = parseResult.success;
        
        if (!parseResult.success) {
            result.errors = parseResult.errors.map(e => `Line ${e.line}: ${e.message}`);
            return result;
        }

        const model = parseResult.model!;
        result.model = model.name ?? 'unnamed';
        result.moleculeTypes = model.moleculeTypes?.length ?? 0;
        result.reactionRules = model.reactionRules?.length ?? 0;
        result.species = model.species?.length ?? 0;
        result.parameters = Object.keys(model.parameters ?? {}).length;
        result.observables = model.observables?.length ?? 0;

        const validation = validateModel(model, false);
        result.warnings = validation.warnings.map(w => w.message);
        result.errors = validation.errors.map(e => e.message);

        const rateConstants = (model.reactionRules ?? []).map(r => {
            if (r.isFunctionalRate) return NaN;
            const val = model.parameters[r.rate];
            if (Number.isFinite(val)) return val;
            const num = Number(r.rate);
            return Number.isFinite(num) ? num : NaN;
        }).filter(v => Number.isFinite(v));

        if (rateConstants.length > 0) {
            const stiff = analyzeModelStiffness(rateConstants, {
                hasFunctionalRates: (model.reactionRules ?? []).some(r => r.isFunctionalRate),
                systemSize: model.species?.length ?? 0,
            });
            result.stiffness = { category: stiff.category, ratio: stiff.rateRatio };
        }

    } catch (e) {
        result.errors.push(String(e));
    }

    return result;
}

async function main() {
    const rulehubPath = resolve(process.cwd(), '..', 'RuleHub');
    const modelsDir = join(rulehubPath, 'models');
    
    if (!existsSync(modelsDir)) {
        console.error('RuleHub models directory not found:', modelsDir);
        process.exit(1);
    }

    console.log('Collecting BNGL files from RuleHub...');
    const bnglFiles = collectBnglFiles(modelsDir);
    console.log(`Found ${bnglFiles.length} BNGL files`);

    const results: DiagnosticResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < bnglFiles.length; i++) {
        const file = bnglFiles[i];
        const relativePath = file.replace(rulehubPath + '/', '');
        
        if (i % 50 === 0) {
            console.log(`Processing ${i + 1}/${bnglFiles.length}...`);
        }

        try {
            const code = readFileSync(file, 'utf-8');
            const result = diagnoseModel(code);
            result.model = relativePath;
            
            if (result.parseSuccess) successCount++;
            else errorCount++;
            
            results.push(result);
        } catch (e) {
            errorCount++;
            results.push({
                model: relativePath,
                parseSuccess: false,
                moleculeTypes: 0,
                reactionRules: 0,
                species: 0,
                parameters: 0,
                observables: 0,
                stiffness: { category: 'unknown', ratio: 1 },
                warnings: [],
                errors: [String(e)],
            });
        }
    }

    const outputPath = join(process.cwd(), 'rulehub-diagnostics.json');
    writeFileSync(outputPath, JSON.stringify(results, null, 2));

    console.log('\n=== RuleHub Diagnostic Summary ===');
    console.log(`Total models: ${results.length}`);
    console.log(`Parseable: ${successCount}`);
    console.log(`Failed: ${errorCount}`);

    const avgRules = results.filter(r => r.parseSuccess).reduce((a, r) => a + r.reactionRules, 0) / Math.max(1, successCount);
    const avgSpecies = results.filter(r => r.parseSuccess).reduce((a, r) => a + r.species, 0) / Math.max(1, successCount);
    const stiffCount = results.filter(r => r.parseSuccess && r.stiffness.category === 'severe').length;

    console.log(`\nAvg rules per model: ${avgRules.toFixed(1)}`);
    console.log(`Avg species per model: ${avgSpecies.toFixed(1)}`);
    console.log(`Stiff models: ${stiffCount}`);

    const outputDir = join(process.cwd(), 'rulehub_diagnostics');
    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    const issues: string[] = [];
    for (const r of results) {
        if (!r.parseSuccess) {
            issues.push(`PARSE_ERROR: ${r.model}`);
        }
        if (r.parseSuccess && r.stiffness.category === 'severe') {
            issues.push(`STIFF: ${r.model} (ratio: ${r.stiffness.ratio.toFixed(2)})`);
        }
        if (r.parseSuccess && r.warnings.length > 3) {
            issues.push(`WARNINGS: ${r.model} (${r.warnings.length} warnings)`);
        }
    }

    if (issues.length > 0) {
        writeFileSync(join(outputDir, 'issues.txt'), issues.join('\n'));
        console.log(`\nIssues written to ${join(outputDir, 'issues.txt')}`);
    }

    console.log(`\nFull results written to ${outputPath}`);
}

main().catch(console.error);
