import { BNGLModel, generateSedML, SedMLExportOptions } from '@bngplayground/engine';

/**
 * Service to export BNGL models to SED-ML
 */
export const exportToSedML = (model: BNGLModel, options?: Partial<SedMLExportOptions>): string => {
  const defaultOptions: SedMLExportOptions = {
    method: 'ode',
    t_end: 100,
    n_steps: 100,
    ...options
  };

  return generateSedML(model, defaultOptions);
};

export default exportToSedML;
