-- revert schema 220
CALL DropIdx('inventory', 'idx_inventory_planned');
CALL DropColumn('inventory', 'is_planned');
UPDATE config SET conf_value = 219 WHERE conf_name = 'schema';
