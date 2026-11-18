<?php

/**
 * @copyright 2026 eLabFTW contributors
 * @license AGPL-3.0
 */

declare(strict_types=1);

namespace Elabftw\Elabftw;

/**
 * Fork-only. The migrations of the database (inventory) branch, applied after CustomMigrationRunner::MIGRATIONS. They live here, not in that
 * list, so the orders branch can keep appending to its list without the two branches editing the same lines.
 *
 * New migrations of this branch are named inv_NNN_name.sql (inv_001_..., inv_002_...) and added at the end of this list. The files before
 * them (110 to 152) keep their names: the runner records applied migrations by file name and checksum, so renaming would only add noise.
 */
final class InventoryMigrations
{
    /** @var list<string> */
    public const array MIGRATIONS = array(
        '110_inventory.sql',
        '111_inventory_steps.sql',
        '112_registry_storage.sql',
        '113_registry_category_fields.sql',
        '114_registry_storage_comment.sql',
        '115_registry_primers.sql',
        '116_registry_folders.sql',
        '117_registry_planned_entries.sql',
        '118_registry_folder_scope.sql',
        '119_registry_personal_ids.sql',
        '120_registry_order_link_field.sql',
        '121_registry_link_field_all.sql',
        // 122 (label formats) and 123 (label bottom margin) are listed in CustomMigrationRunner::MIGRATIONS (label printing is shared with the orders branch)
        '124_registry_module_settings.sql',
        '125_registry_column_prefs.sql',
        '126_registry_entity_links.sql',
        '127_registry_consumables_module.sql',
        '128_storage_unit_info.sql',
        '129_registry_settings.sql',
        '130_storage_unit_position.sql',
        '131_storage_unit_kind.sql',
        '132_storage_unit_capacity.sql',
        '133_storage_unit_child_capacity.sql',
        '134_storage_kinds.sql',
        '135_storage_unit_comment.sql',
        '136_container_cap_colour.sql',
        '137_stock_alerts.sql',
        '138_module_low_stock.sql',
        '139_personal_storage.sql',
        '140_owner_map.sql',
        '141_ai_search.sql',
        '142_ai_search_features.sql',
        '143_owner_map_editors.sql',
        '144_personal_groups.sql',
        '145_module_allows_reads.sql',
        '146_column_order.sql',
        '147_personal_modules.sql',
        '148_personal_module_views.sql',
        '149_personal_entries_admins.sql',
        '150_personal_module_views_closed.sql',
        '151_personal_module_views_module.sql',
        '152_backbone_cache.sql',
    );
}
