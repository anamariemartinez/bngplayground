/**
 * wasm-libbng/libbng_wrapper.cpp
 *
 * Thin C API wrapper around libBNG for WASM consumption.
 * Based on API audit of mcellteam/libbng (commit: HEAD as of 2026-03-21).
 *
 * Design: No simulation logic here — just BNGL parsing, species management,
 * reaction class queries, and reaction resolution. The spatial engine
 * calls these functions to determine what happens when molecules collide.
 *
 * Key API findings from audit:
 *   - BNGEngine requires const BNGConfig& in constructor
 *   - Parser: parse_bngl_file() reads from filesystem (we use EMSCRIPTEN VFS)
 *   - RxnContainer::get_bimol_rxn_class(species_a, species_b) -> RxnClass*
 *   - RxnContainer::get_unimol_rxn_class(species_id) -> RxnClass*
 *   - RxnClass::get_max_fixed_p() -> double (triggers pathway init)
 *   - RxnClass::get_pathway_index_for_probability(prob, factor) -> pathway_index
 *   - RxnClass::get_rxn_products_for_pathway(index) -> RxnProductsVector
 *   - BNGEngine::get_rxn_product_species_id(rxn, prod_idx, reac_a, reac_b) -> species_id
 */

#include "bng/bng.h"
#include <cstring>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>

// --- Module-level state ---
// One BNGEngine instance per simulation. Thread-safety not required
// (single Web Worker per simulation).
static BNG::BNGConfig g_config;
static BNG::BNGEngine* g_engine = nullptr;
static std::string g_last_error;
static std::string g_tmp_str; // scratch buffer for string returns

extern "C" {

// ============================================================
// Lifecycle
// ============================================================

/**
 * Initialize a BNGEngine from a BNGL model string.
 * We write the string to a temp file and use libBNG's file parser
 * (via Emscripten's virtual filesystem).
 * Returns 0 on success, -1 on parse error.
 */
int libbng_init(const char* bngl_text) {
    try {
        // Clean up previous engine
        if (g_engine) {
            delete g_engine;
            g_engine = nullptr;
        }

        // Configure BNGConfig with sensible defaults for spatial simulation
        g_config = BNG::BNGConfig();
        g_config.initial_seed = 1;
        g_config.use_bng_units = false;
        // MCell-compatible unit system
        // time_unit: seconds per internal time unit
        // length_unit: micrometers per internal length unit
        g_config.time_unit = 1e-6;   // 1 microsecond
        g_config.length_unit = 1.0;  // 1 micrometer
        g_config.rxn_radius_3d = 0.0; // will be computed per-reaction
        g_config.rxn_and_species_report = false; // no report files in WASM
        g_config.notifications.bng_verbosity_level = 0;
        g_config.init();

        // Create the engine
        g_engine = new BNG::BNGEngine(g_config);

        // Write BNGL text to a temp file for the parser
        const std::string tmp_path = "/tmp/_libbng_model.bngl";
        {
            std::ofstream ofs(tmp_path);
            if (!ofs) {
                g_last_error = "Failed to write temp BNGL file";
                delete g_engine;
                g_engine = nullptr;
                return -1;
            }
            ofs << bngl_text;
        }

        // Parse the BNGL file
        int num_errors = BNG::parse_bngl_file(
            tmp_path,
            g_engine->get_data()
        );

        if (num_errors > 0) {
            g_last_error = "BNGL parse failed with " + std::to_string(num_errors) + " error(s)";
            delete g_engine;
            g_engine = nullptr;
            return -1;
        }

        // Initialize the engine (sets up reaction classes, etc.)
        g_engine->initialize();

        return 0;
    } catch (const std::exception& e) {
        g_last_error = std::string("Exception during init: ") + e.what();
        if (g_engine) { delete g_engine; g_engine = nullptr; }
        return -1;
    }
}

/**
 * Destroy the engine and free all memory.
 */
void libbng_destroy() {
    if (g_engine) {
        delete g_engine;
        g_engine = nullptr;
    }
}

/**
 * Get the last error message. Pointer valid until next call.
 */
const char* libbng_get_last_error() {
    return g_last_error.c_str();
}

// ============================================================
// Species management
// ============================================================

int libbng_species_count() {
    if (!g_engine) return 0;
    return (int)g_engine->get_all_species().get_count();
}

/**
 * Get the canonical BNGL name for a species by ID.
 * Returns pointer to static buffer (valid until next call).
 */
const char* libbng_species_name(int species_id) {
    if (!g_engine || species_id < 0) return "";
    BNG::species_id_t sid = (BNG::species_id_t)species_id;
    if (!g_engine->get_all_species().is_valid_id(sid)) return "";
    const BNG::Species& sp = g_engine->get_all_species().get(sid);
    g_tmp_str = sp.name;
    return g_tmp_str.c_str();
}

/**
 * Get the compartment ID for a species. -1 if no compartment.
 */
int libbng_species_compartment(int species_id) {
    if (!g_engine || species_id < 0) return -1;
    BNG::species_id_t sid = (BNG::species_id_t)species_id;
    if (!g_engine->get_all_species().is_valid_id(sid)) return -1;
    const BNG::Species& sp = g_engine->get_all_species().get(sid);
    BNG::compartment_id_t cid = sp.get_primary_compartment_id();
    if (cid == BNG::COMPARTMENT_ID_INVALID || cid == BNG::COMPARTMENT_ID_NONE) {
        return -1;
    }
    return (int)cid;
}

// ============================================================
// Bimolecular reaction resolution
// ============================================================

/**
 * Check if species_a and species_b can react via a bimolecular reaction.
 * Returns 1 if a RxnClass exists, 0 otherwise.
 * This triggers lazy reaction class creation in libBNG.
 */
int libbng_check_bimol_reaction(int species_a, int species_b) {
    if (!g_engine) return 0;
    BNG::species_id_t sa = (BNG::species_id_t)species_a;
    BNG::species_id_t sb = (BNG::species_id_t)species_b;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_bimol_rxn_class(sa, sb);
    return (rxn_class != nullptr && rxn_class->is_standard()) ? 1 : 0;
}

/**
 * Get the maximum reaction probability for a bimolecular reaction class.
 * Must call libbng_check_bimol_reaction first to ensure the class exists.
 * Returns 0.0 if no reaction class.
 */
double libbng_get_rxn_class_max_prob(int species_a, int species_b) {
    if (!g_engine) return 0.0;
    BNG::species_id_t sa = (BNG::species_id_t)species_a;
    BNG::species_id_t sb = (BNG::species_id_t)species_b;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_bimol_rxn_class(sa, sb);
    if (!rxn_class || !rxn_class->is_standard()) return 0.0;

    return rxn_class->get_max_fixed_p();
}

/**
 * Given a random probability [0, max_fixed_p), determine which reaction
 * pathway is selected.
 * Returns pathway index, or -2 (PATHWAY_INDEX_NO_RXN) if no reaction occurs.
 */
int libbng_get_pathway_for_prob(int species_a, int species_b, double prob) {
    if (!g_engine) return BNG::PATHWAY_INDEX_NO_RXN;
    BNG::species_id_t sa = (BNG::species_id_t)species_a;
    BNG::species_id_t sb = (BNG::species_id_t)species_b;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_bimol_rxn_class(sa, sb);
    if (!rxn_class || !rxn_class->is_standard()) return BNG::PATHWAY_INDEX_NO_RXN;

    // local_prob_factor is 1.0 for uniform simulations
    return (int)rxn_class->get_pathway_index_for_probability(prob, 1.0);
}

/**
 * Get the number of products for a specific pathway.
 */
int libbng_get_pathway_product_count(int species_a, int species_b, int pathway_index) {
    if (!g_engine || pathway_index < 0) return 0;
    BNG::species_id_t sa = (BNG::species_id_t)species_a;
    BNG::species_id_t sb = (BNG::species_id_t)species_b;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_bimol_rxn_class(sa, sb);
    if (!rxn_class) return 0;

    const BNG::RxnProductsVector& products = rxn_class->get_rxn_products_for_pathway(
        (BNG::rxn_class_pathway_index_t)pathway_index
    );
    return (int)products.size();
}

/**
 * Get the species ID of a specific product from a pathway.
 * product_index: 0-based index into the product list.
 */
int libbng_get_pathway_product_species_id(
    int species_a, int species_b, int pathway_index, int product_index
) {
    if (!g_engine || pathway_index < 0 || product_index < 0) return -1;
    BNG::species_id_t sa = (BNG::species_id_t)species_a;
    BNG::species_id_t sb = (BNG::species_id_t)species_b;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_bimol_rxn_class(sa, sb);
    if (!rxn_class) return -1;

    const BNG::RxnProductsVector& products = rxn_class->get_rxn_products_for_pathway(
        (BNG::rxn_class_pathway_index_t)pathway_index
    );
    if ((size_t)product_index >= products.size()) return -1;

    return (int)products[product_index].product_species_id;
}

// ============================================================
// Unimolecular reaction resolution
// ============================================================

/**
 * Check if a species has unimolecular reactions.
 * Returns 1 if yes, 0 otherwise.
 */
int libbng_check_unimol_reaction(int species_id) {
    if (!g_engine) return 0;
    BNG::species_id_t sid = (BNG::species_id_t)species_id;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_unimol_rxn_class(sid);
    return (rxn_class != nullptr && rxn_class->is_standard()) ? 1 : 0;
}

/**
 * Get the maximum reaction probability for a unimolecular reaction class.
 */
double libbng_get_unimol_max_prob(int species_id) {
    if (!g_engine) return 0.0;
    BNG::species_id_t sid = (BNG::species_id_t)species_id;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_unimol_rxn_class(sid);
    if (!rxn_class || !rxn_class->is_standard()) return 0.0;

    return rxn_class->get_max_fixed_p();
}

/**
 * Given a random probability [0, max_fixed_p), determine which unimolecular
 * reaction pathway is selected.
 */
int libbng_get_unimol_pathway_for_prob(int species_id, double prob) {
    if (!g_engine) return BNG::PATHWAY_INDEX_NO_RXN;
    BNG::species_id_t sid = (BNG::species_id_t)species_id;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_unimol_rxn_class(sid);
    if (!rxn_class || !rxn_class->is_standard()) return BNG::PATHWAY_INDEX_NO_RXN;

    return (int)rxn_class->get_pathway_index_for_probability(prob, 1.0);
}

/**
 * Apply a unimolecular pathway. Same interface as bimolecular but with
 * only one reactant.
 * Returns number of products, writes product species IDs to product_ids.
 */
int libbng_apply_unimol_pathway(
    int species_id, int pathway_index,
    int* product_ids, int max_products
) {
    if (!g_engine || pathway_index < 0 || !product_ids || max_products <= 0) return 0;
    BNG::species_id_t sid = (BNG::species_id_t)species_id;

    BNG::RxnClass* rxn_class = g_engine->get_all_rxns().get_unimol_rxn_class(sid);
    if (!rxn_class) return 0;

    const BNG::RxnProductsVector& products = rxn_class->get_rxn_products_for_pathway(
        (BNG::rxn_class_pathway_index_t)pathway_index
    );

    int count = 0;
    for (size_t i = 0; i < products.size() && count < max_products; i++) {
        product_ids[count++] = (int)products[i].product_species_id;
    }
    return count;
}

// ============================================================
// Rate constants
// ============================================================

double libbng_rule_rate(int rule_index) {
    if (!g_engine || rule_index < 0) return 0.0;
    const BNG::RxnRuleVector& rules = g_engine->get_all_rxns().get_rxn_rules_vector();
    if ((size_t)rule_index >= rules.size()) return 0.0;
    return rules[rule_index]->get_rate_constant();
}

int libbng_rule_count() {
    if (!g_engine) return 0;
    return (int)g_engine->get_all_rxns().get_rxn_rules_vector().size();
}

// ============================================================
// Compartments
// ============================================================

int libbng_compartment_count() {
    if (!g_engine) return 0;
    return (int)g_engine->get_data().get_compartments().size();
}

const char* libbng_compartment_name(int index) {
    if (!g_engine || index < 0) return "";
    const auto& comps = g_engine->get_data().get_compartments();
    if ((size_t)index >= comps.size()) return "";
    g_tmp_str = comps[index].name;
    return g_tmp_str.c_str();
}

/**
 * Returns 1 if the compartment is 3D (volume), 0 if 2D (surface).
 */
int libbng_compartment_is_3d(int index) {
    if (!g_engine || index < 0) return -1;
    const auto& comps = g_engine->get_data().get_compartments();
    if ((size_t)index >= comps.size()) return -1;
    return comps[index].is_3d ? 1 : 0;
}

/**
 * Get compartment volume (3D) or area (2D).
 */
double libbng_compartment_volume(int index) {
    if (!g_engine || index < 0) return 0.0;
    const auto& comps = g_engine->get_data().get_compartments();
    if ((size_t)index >= comps.size()) return 0.0;
    const BNG::Compartment& c = comps[index];
    if (!c.is_volume_or_area_set()) return 0.0;
    return c.is_3d ? c.get_volume() : c.get_area();
}

/**
 * Get parent compartment ID. Returns -1 if no parent.
 */
int libbng_compartment_parent(int index) {
    if (!g_engine || index < 0) return -1;
    const auto& comps = g_engine->get_data().get_compartments();
    if ((size_t)index >= comps.size()) return -1;
    const BNG::Compartment& c = comps[index];
    if (c.parent_compartment_id == BNG::COMPARTMENT_ID_INVALID) return -1;
    return (int)c.parent_compartment_id;
}

// ============================================================
// Molecule types
// ============================================================

int libbng_mol_type_count() {
    if (!g_engine) return 0;
    return (int)g_engine->get_data().get_elem_mol_types().size();
}

const char* libbng_mol_type_name(int index) {
    if (!g_engine || index < 0) return "";
    const auto& types = g_engine->get_data().get_elem_mol_types();
    if ((size_t)index >= types.size()) return "";
    g_tmp_str = types[index].name;
    return g_tmp_str.c_str();
}

// ============================================================
// Seed species
// ============================================================

int libbng_seed_species_count() {
    if (!g_engine) return 0;
    return (int)g_engine->get_data().get_seed_species().size();
}

const char* libbng_seed_species_name(int index) {
    if (!g_engine || index < 0) return "";
    const auto& seeds = g_engine->get_data().get_seed_species();
    if ((size_t)index >= seeds.size()) return "";
    g_tmp_str = seeds[index].cplx.to_str();
    return g_tmp_str.c_str();
}

double libbng_seed_species_amount(int index) {
    if (!g_engine || index < 0) return 0.0;
    const auto& seeds = g_engine->get_data().get_seed_species();
    if ((size_t)index >= seeds.size()) return 0.0;
    return seeds[index].count;
}

// ============================================================
// Observables
// ============================================================

int libbng_observable_count() {
    if (!g_engine) return 0;
    return (int)g_engine->get_data().get_observables().size();
}

const char* libbng_observable_name(int index) {
    if (!g_engine || index < 0) return "";
    const auto& obs = g_engine->get_data().get_observables();
    if ((size_t)index >= obs.size()) return "";
    g_tmp_str = obs[index].name;
    return g_tmp_str.c_str();
}

// ============================================================
// Parameters
// ============================================================

/**
 * Get a parameter value by name.
 * Returns the value, or NaN if not found.
 */
double libbng_get_parameter(const char* name) {
    if (!g_engine || !name) return 0.0 / 0.0; // NaN
    double value = 0.0;
    if (g_engine->get_data().get_parameter_value(std::string(name), value)) {
        return value;
    }
    return 0.0 / 0.0; // NaN
}

} // extern "C"
