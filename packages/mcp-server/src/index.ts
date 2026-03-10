// === MCP stdio transport compatibility ===
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Only redirect console and change CWD if running as the main script
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href || process.env.MCP_SERVER_RUN === 'true';

if (isMain) {
  // Set CWD to project root (Claude Desktop launches from System32)
  process.chdir(resolve(__dirname, '..', '..', '..'));

  // MCP uses stdout for JSON-RPC - redirect all console output to stderr
  const _write = (msg: string) => { process.stderr.write(msg + '\n'); };
  console.log = (...args: any[]) => _write(args.map(String).join(' '));
  console.warn = (...args: any[]) => _write('[WARN] ' + args.map(String).join(' '));
  console.error = (...args: any[]) => _write('[ERROR] ' + args.map(String).join(' '));
  console.info = (...args: any[]) => _write(args.map(String).join(' '));
  console.debug = (...args: any[]) => _write('[DEBUG] ' + args.map(String).join(' '));
}

import { Server, StdioServerTransport, CallToolRequestSchema, ListToolsRequestSchema } from './sdk.js';

import { simulationMethods, solverValues } from './schemas/index.js';

import { handleParseBngl } from './handlers/parseBngl.js';
import { handleGenerateNetwork } from './handlers/generateNetwork.js';
import { handleSimulate } from './handlers/simulate.js';
import { handleParameterScan } from './handlers/parameterScan.js';
import { handleValidateModel } from './handlers/validateModel.js';
import { handleGetContactMap } from './handlers/getContactMap.js';
import { handleFitParameters } from './handlers/fitParameters.js';
import { handleDiagnose } from './handlers/diagnose.js';

const server = new Server(
  {
    name: 'bng-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'parse_bngl',
        description: 'Parse BNGL (BioNetGen Language) code and return structured result',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'BNGL code to parse',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'generate_network',
        description: 'Generate expanded reaction network from BNGL model',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'BNGL code to generate network from',
            },
            max_agents: {
              type: 'number',
              description: 'Maximum number of agent patterns (default: 1000)',
            },
            max_iterations: {
              type: 'number',
              description: 'Maximum number of expansion iterations (default: 100)',
            },
            max_reactions: {
              type: 'number',
              description: 'Maximum number of generated reactions',
            },
            max_agg: {
              type: 'number',
              description: 'Maximum aggregate size during expansion',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'simulate',
        description: 'Run ODE/SSA simulation on BNGL model',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'BNGL code to simulate',
            },
            method: {
              type: 'string',
              enum: [...simulationMethods],
              description: 'Simulation method (default: ode)',
            },
            t_end: {
              type: 'number',
              description: 'End time for simulation (default: 10)',
            },
            n_steps: {
              type: 'number',
              description: 'Number of time points (default: 100)',
            },
            solver: {
              type: 'string',
              enum: [...solverValues],
              description: 'Optional ODE solver override. Defaults to rk4 for ODE requests.',
            },
            atol: {
              type: 'number',
              description: 'Absolute tolerance for deterministic solvers',
            },
            rtol: {
              type: 'number',
              description: 'Relative tolerance for deterministic solvers',
            },
            max_steps: {
              type: 'number',
              description: 'Maximum internal solver steps',
            },
            seed: {
              type: 'number',
              description: 'Random seed for stochastic simulations',
            },
            sparse: {
              type: 'boolean',
              description: 'Request sparse deterministic solving when supported',
            },
            include_species_data: {
              type: 'boolean',
              description: 'Include species trajectories in the response',
            },
            max_agents: {
              type: 'number',
              description: 'Max generated species',
            },
            max_reactions: {
              type: 'number',
              description: 'Max generated reactions',
            },
            max_iterations: {
              type: 'number',
              description: 'Max iterations',
            },
            max_agg: {
              type: 'number',
              description: 'Max aggregate size',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'parameter_scan',
        description: 'Run a 1D or 2D parameter scan while reusing a single expanded network',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code to scan' },
            parameter: { type: 'string', description: 'Primary parameter name to scan' },
            start: { type: 'number', description: 'Start value for the primary parameter' },
            end: { type: 'number', description: 'End value for the primary parameter' },
            steps: { type: 'number', description: 'Number of primary scan points' },
            parameter2: { type: 'string', description: 'Optional second parameter for a 2D scan' },
            start2: { type: 'number', description: 'Start value for the secondary parameter' },
            end2: { type: 'number', description: 'End value for the secondary parameter' },
            steps2: { type: 'number', description: 'Number of secondary scan points' },
            logarithmic: { type: 'boolean', description: 'Use log-spaced ranges instead of linear spacing' },
            method: { type: 'string', enum: [...simulationMethods], description: 'Simulation method for each scan point' },
            t_end: { type: 'number', description: 'End time for each simulation' },
            n_steps: { type: 'number', description: 'Number of output steps for each simulation' },
            solver: { type: 'string', enum: [...solverValues], description: 'Optional deterministic solver override' },
          },
          required: ['code', 'parameter', 'start', 'end', 'steps'],
        },
      },
      {
        name: 'validate_model',
        description: 'Parse and validate BNGL structure, observables, and NFsim compatibility',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code to validate' },
            include_nfsim: { type: 'boolean', description: 'Include NFsim compatibility checks in the result' },
          },
          required: ['code'],
        },
      },
      {
        name: 'get_contact_map',
        description: 'Build a static contact map from the parsed molecule types and reaction rules',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code to analyze' },
          },
          required: ['code'],
        },
      },
      {
        name: 'fit_parameters',
        description: 'Optimize model parameters to match experimental data',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code' },
            parameters: {
              type: 'object',
              description: 'Map of param name to { min, max, initial? }'
            },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'number' },
                  observables: { type: 'object' }
                }
              },
              description: 'Experimental data points'
            },
            method: { type: 'string', enum: ['ode', 'ssa'], default: 'ode' },
            algorithm: { type: 'string', enum: ['nelder-mead', 'sbplx'], default: 'nelder-mead' }
          },
          required: ['code', 'parameters', 'data'],
        },
      },
      {
        name: 'diagnose',
        description: 'Pre-flight check for model complexity, stiffness, and potential simulation issues',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'BNGL code to analyze' },
          },
          required: ['code'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request: { params: { name: string; arguments: Record<string, unknown> } }) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case 'parse_bngl':
      return handleParseBngl(args);
    case 'generate_network':
      return handleGenerateNetwork(args);
    case 'simulate':
      return handleSimulate(args);
    case 'parameter_scan':
      return handleParameterScan(args);
    case 'validate_model':
      return handleValidateModel(args);
    case 'get_contact_map':
      return handleGetContactMap(args);
    case 'fit_parameters':
      return handleFitParameters(args);
    case 'diagnose':
      return handleDiagnose(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// start listening (stubbed behavior for tests, stdio transport for runtime)
if (isMain) {
  server.listen?.(new StdioServerTransport());
}

export { server };
