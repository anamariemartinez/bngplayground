export function buildMoleculeGraph(ruleDescriptors: Array<{ reactants: string[]; products: string[] }>): Map<string, Set<string>> {
    const graph = new Map<string, Set<string>>();
    const connect = (a: string, b: string) => {
        if (a === b) return;
        if (!graph.has(a)) graph.set(a, new Set<string>());
        if (!graph.has(b)) graph.set(b, new Set<string>());
        graph.get(a)!.add(b);
        graph.get(b)!.add(a);
    };

    for (const descriptor of ruleDescriptors) {
        const molecules = Array.from(new Set([
            ...descriptor.reactants.flatMap(extractMoleculeNames),
            ...descriptor.products.flatMap(extractMoleculeNames),
        ]));
        for (let i = 0; i < molecules.length; i++) {
            for (let j = i + 1; j < molecules.length; j++) {
                connect(molecules[i], molecules[j]);
            }
        }
    }

    return graph;
}

export function findShortestPath(
    graph: Map<string, Set<string>>,
    sources: string[],
    targets: Set<string>,
    maxDepth = 6,
): string[] {
    const queue: Array<{ node: string; path: string[]; depth: number }> = [];
    const visited = new Set<string>();

    for (const source of sources) {
        if (!source) continue;
        queue.push({ node: source, path: [source], depth: 0 });
        visited.add(source);
        if (targets.has(source)) {
            return [source];
        }
    }

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= maxDepth) {
            continue;
        }
        const neighbors = graph.get(current.node);
        if (!neighbors) {
            continue;
        }
        for (const neighbor of neighbors) {
            if (visited.has(neighbor)) {
                continue;
            }
            const nextPath = [...current.path, neighbor];
            if (targets.has(neighbor)) {
                return nextPath;
            }
            visited.add(neighbor);
            queue.push({ node: neighbor, path: nextPath, depth: current.depth + 1 });
        }
    }

    return [];
}

export function extractMoleculeNames(pattern: string): string[] {
    const names: string[] = [];
    const regex = /\b([A-Za-z][A-Za-z0-9_]*)\(/g;
    let match;
    while ((match = regex.exec(pattern)) !== null) {
        names.push(match[1]);
    }
    if (names.length === 0 && pattern.includes('(')) {
        const simple = pattern.split('(')[0].trim();
        if (simple) names.push(simple);
    } else if (names.length === 0 && pattern.trim()) {
        names.push(pattern.trim());
    }
    return names;
}