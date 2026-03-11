import { BNGLModel, generateOMEX, OMEXExportOptions } from '@bngplayground/engine';

/**
 * Service to export BNGL models to COMBINE/OMEX archives
 */
export const exportToOMEX = (model: BNGLModel, bnglCode: string, options?: Partial<OMEXExportOptions>): Uint8Array => {
  const defaultOptions: OMEXExportOptions = {
    bnglCode,
    modelName: model.name || 'model',
    simulationOptions: {
      method: 'ode',
      t_end: 100,
      n_steps: 100
    },
    ...options
  };

  return generateOMEX(model, defaultOptions);
};

export default exportToOMEX;
