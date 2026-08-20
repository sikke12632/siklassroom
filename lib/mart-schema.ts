export const MART_SCHEMA_STATEMENTS = [
  `DROP VIEW IF EXISTS mart_effective_market_clerks`,
  `CREATE VIEW mart_effective_market_clerks AS
SELECT DISTINCT permission.class_id,
       permission.student_id,
       permission.period_id
FROM student_effective_permissions permission
WHERE permission.permission_key = 'mart_operator'
  AND permission.period_id IS NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS mart_operations (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_teacher_id TEXT,
  actor_student_id TEXT,
  actor_job_period_id TEXT,
  actor_label TEXT NOT NULL,
  intervention_reason TEXT,
  expected_class_revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (actor_teacher_id) REFERENCES teachers(id),
  FOREIGN KEY (actor_student_id) REFERENCES students(id),
  FOREIGN KEY (actor_job_period_id) REFERENCES class_job_assignment_periods(id),
  CONSTRAINT mart_operations_operation_ck CHECK (
    operation IN (
      'product_create', 'product_update',
      'inventory_inbound', 'inventory_outbound', 'inventory_correction',
      'sale_create', 'sale_cancel'
    )
  ),
  CONSTRAINT mart_operations_actor_ck CHECK (
    (actor_type = 'teacher'
      AND actor_teacher_id IS NOT NULL
      AND actor_student_id IS NULL
      AND actor_job_period_id IS NULL)
    OR
    (actor_type = 'market_clerk'
      AND actor_teacher_id IS NULL
      AND actor_student_id IS NOT NULL
      AND actor_job_period_id IS NOT NULL)
  ),
  CONSTRAINT mart_operations_reason_ck CHECK (
    operation NOT IN ('inventory_correction', 'sale_cancel')
    OR LENGTH(TRIM(COALESCE(intervention_reason, ''))) BETWEEN 2 AND 300
  ),
  CONSTRAINT mart_operations_revision_ck CHECK (expected_class_revision >= 0)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_operations_id_class_uq
  ON mart_operations(id, class_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_operations_class_idempotency_uq
  ON mart_operations(class_id, idempotency_key);`,
  `CREATE INDEX IF NOT EXISTS mart_operations_class_created_idx
  ON mart_operations(class_id, created_at);`,
  `CREATE TABLE IF NOT EXISTS mart_products (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  unit_price INTEGER NOT NULL,
  low_stock_threshold INTEGER DEFAULT 2 NOT NULL,
  is_active INTEGER DEFAULT 1 NOT NULL,
  revision INTEGER DEFAULT 0 NOT NULL,
  created_operation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (created_operation_id, class_id)
    REFERENCES mart_operations(id, class_id),
  CONSTRAINT mart_products_name_ck CHECK (LENGTH(TRIM(name)) BETWEEN 1 AND 60),
  CONSTRAINT mart_products_category_ck CHECK (LENGTH(TRIM(category)) BETWEEN 1 AND 40),
  CONSTRAINT mart_products_description_ck CHECK (LENGTH(description) <= 300),
  CONSTRAINT mart_products_price_ck CHECK (unit_price BETWEEN 1 AND 1000000000),
  CONSTRAINT mart_products_low_stock_ck CHECK (
    low_stock_threshold BETWEEN 0 AND 1000000000
  ),
  CONSTRAINT mart_products_active_ck CHECK (is_active IN (0, 1)),
  CONSTRAINT mart_products_revision_ck CHECK (revision >= 0)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_products_id_class_uq ON mart_products(id, class_id);`,
  `CREATE INDEX IF NOT EXISTS mart_products_class_active_idx
  ON mart_products(class_id, is_active, updated_at);`,
  `CREATE TABLE IF NOT EXISTS mart_inventory (
  product_id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  quantity INTEGER DEFAULT 0 NOT NULL,
  revision INTEGER DEFAULT 0 NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (product_id, class_id) REFERENCES mart_products(id, class_id),
  CONSTRAINT mart_inventory_quantity_ck CHECK (quantity BETWEEN 0 AND 1000000000),
  CONSTRAINT mart_inventory_revision_ck CHECK (revision >= 0)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_inventory_product_class_uq
  ON mart_inventory(product_id, class_id);`,
  `CREATE INDEX IF NOT EXISTS mart_inventory_class_quantity_idx
  ON mart_inventory(class_id, quantity);`,
  `CREATE TABLE IF NOT EXISTS mart_product_events (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  product_snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (product_id, class_id) REFERENCES mart_products(id, class_id),
  FOREIGN KEY (operation_id, class_id) REFERENCES mart_operations(id, class_id),
  CONSTRAINT mart_product_events_action_ck CHECK (
    action IN ('created', 'updated', 'activated', 'deactivated')
  ),
  CONSTRAINT mart_product_events_revision_ck CHECK (revision >= 0)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_product_events_product_revision_uq
  ON mart_product_events(product_id, revision);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_product_events_operation_uq
  ON mart_product_events(operation_id);`,
  `CREATE INDEX IF NOT EXISTS mart_product_events_class_created_idx
  ON mart_product_events(class_id, created_at);`,
  `CREATE TABLE IF NOT EXISTS mart_sales (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  buyer_student_id TEXT NOT NULL,
  buyer_student_number_snapshot INTEGER NOT NULL,
  buyer_student_name_snapshot TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  total_quantity INTEGER NOT NULL,
  status TEXT DEFAULT 'building' NOT NULL,
  revision INTEGER DEFAULT 0 NOT NULL,
  created_operation_id TEXT NOT NULL,
  cancelled_operation_id TEXT,
  cancelled_reason TEXT,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (buyer_student_id) REFERENCES students(id),
  FOREIGN KEY (created_operation_id, class_id)
    REFERENCES mart_operations(id, class_id),
  FOREIGN KEY (cancelled_operation_id, class_id)
    REFERENCES mart_operations(id, class_id),
  CONSTRAINT mart_sales_amount_ck CHECK (total_amount BETWEEN 1 AND 1000000000),
  CONSTRAINT mart_sales_quantity_ck CHECK (total_quantity BETWEEN 1 AND 1000000000),
  CONSTRAINT mart_sales_status_ck CHECK (status IN ('building', 'posted', 'cancelled')),
  CONSTRAINT mart_sales_revision_ck CHECK (revision >= 0),
  CONSTRAINT mart_sales_cancelled_ck CHECK (
    (status = 'cancelled'
      AND revision = 1
      AND cancelled_operation_id IS NOT NULL
      AND LENGTH(TRIM(COALESCE(cancelled_reason, ''))) BETWEEN 2 AND 300
      AND cancelled_at IS NOT NULL)
    OR
    (status IN ('building', 'posted')
      AND revision = 0
      AND cancelled_operation_id IS NULL
      AND cancelled_reason IS NULL
      AND cancelled_at IS NULL)
  )
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_sales_id_class_uq ON mart_sales(id, class_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_sales_created_operation_uq
  ON mart_sales(created_operation_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_sales_cancelled_operation_uq
  ON mart_sales(cancelled_operation_id)
  WHERE cancelled_operation_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS mart_sales_class_created_idx
  ON mart_sales(class_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS mart_sales_buyer_created_idx
  ON mart_sales(buyer_student_id, created_at);`,
  `CREATE TABLE IF NOT EXISTS mart_sale_items (
  id TEXT PRIMARY KEY NOT NULL,
  sale_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  unit_price_snapshot INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sale_id, class_id) REFERENCES mart_sales(id, class_id),
  FOREIGN KEY (product_id, class_id) REFERENCES mart_products(id, class_id),
  CONSTRAINT mart_sale_items_name_ck CHECK (
    LENGTH(TRIM(product_name_snapshot)) BETWEEN 1 AND 60
  ),
  CONSTRAINT mart_sale_items_amount_ck CHECK (
    unit_price_snapshot BETWEEN 1 AND 1000000000
    AND quantity BETWEEN 1 AND 1000000000
    AND line_total = unit_price_snapshot * quantity
    AND line_total BETWEEN 1 AND 1000000000
  )
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_sale_items_id_class_uq
  ON mart_sale_items(id, class_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_sale_items_sale_product_uq
  ON mart_sale_items(sale_id, product_id);`,
  `CREATE INDEX IF NOT EXISTS mart_sale_items_product_idx
  ON mart_sale_items(product_id, created_at);`,
  `CREATE TABLE IF NOT EXISTS mart_sale_cancellations (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  expected_sale_revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  cancelled_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sale_id, class_id) REFERENCES mart_sales(id, class_id),
  FOREIGN KEY (operation_id, class_id) REFERENCES mart_operations(id, class_id),
  CONSTRAINT mart_sale_cancellations_revision_ck CHECK (expected_sale_revision >= 0),
  CONSTRAINT mart_sale_cancellations_reason_ck CHECK (
    LENGTH(TRIM(reason)) BETWEEN 2 AND 300
  )
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_sale_cancellations_sale_uq
  ON mart_sale_cancellations(sale_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_sale_cancellations_operation_uq
  ON mart_sale_cancellations(operation_id);`,
  `CREATE TABLE IF NOT EXISTS mart_inventory_movements (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  delta INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  inventory_revision_before INTEGER NOT NULL,
  inventory_revision_after INTEGER NOT NULL,
  source_sale_id TEXT,
  source_sale_item_id TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (product_id, class_id) REFERENCES mart_products(id, class_id),
  FOREIGN KEY (operation_id, class_id) REFERENCES mart_operations(id, class_id),
  FOREIGN KEY (source_sale_id, class_id) REFERENCES mart_sales(id, class_id),
  FOREIGN KEY (source_sale_item_id, class_id) REFERENCES mart_sale_items(id, class_id),
  CONSTRAINT mart_inventory_movements_type_ck CHECK (
    movement_type IN ('inbound', 'outbound', 'correction', 'sale', 'sale_cancel')
  ),
  CONSTRAINT mart_inventory_movements_quantity_ck CHECK (
    delta <> 0
    AND quantity_before BETWEEN 0 AND 1000000000
    AND quantity_after = quantity_before + delta
    AND quantity_after BETWEEN 0 AND 1000000000
  ),
  CONSTRAINT mart_inventory_movements_revision_ck CHECK (
    inventory_revision_before >= 0
    AND inventory_revision_after = inventory_revision_before + 1
  ),
  CONSTRAINT mart_inventory_movements_source_ck CHECK (
    (movement_type IN ('inbound', 'outbound', 'correction')
      AND source_sale_id IS NULL AND source_sale_item_id IS NULL)
    OR
    (movement_type IN ('sale', 'sale_cancel')
      AND source_sale_id IS NOT NULL AND source_sale_item_id IS NOT NULL)
  ),
  CONSTRAINT mart_inventory_movements_reason_ck CHECK (
    movement_type NOT IN ('inbound', 'outbound', 'correction')
    OR LENGTH(TRIM(COALESCE(reason, ''))) BETWEEN 2 AND 300
  )
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mart_inventory_movements_product_revision_uq
  ON mart_inventory_movements(product_id, inventory_revision_after);`,
  `CREATE INDEX IF NOT EXISTS mart_inventory_movements_class_created_idx
  ON mart_inventory_movements(class_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS mart_inventory_movements_operation_idx
  ON mart_inventory_movements(operation_id);`,
  `CREATE INDEX IF NOT EXISTS mart_inventory_movements_sale_idx
  ON mart_inventory_movements(source_sale_id, movement_type);`,
  `CREATE TRIGGER IF NOT EXISTS mart_operations_insert_revision_guard
BEFORE INSERT ON mart_operations
WHEN NEW.expected_class_revision <> (
  SELECT COUNT(*) FROM mart_operations operation
  WHERE operation.class_id = NEW.class_id
)
BEGIN SELECT RAISE(ABORT, 'MART_CONTEXT_STALE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_operations_insert_class_guard
BEFORE INSERT ON mart_operations
WHEN NOT EXISTS (
  SELECT 1 FROM classes classroom
  WHERE classroom.id = NEW.class_id AND classroom.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'MART_CLASS_NOT_ACTIVE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_operations_insert_teacher_guard
BEFORE INSERT ON mart_operations
WHEN NEW.actor_type = 'teacher' AND NOT EXISTS (
  SELECT 1 FROM classes classroom
  WHERE classroom.id = NEW.class_id
    AND classroom.teacher_id = NEW.actor_teacher_id
    AND classroom.status = 'active'
)
BEGIN SELECT RAISE(ABORT, 'MART_CLASS_ACCESS_DENIED'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_operations_insert_clerk_guard
BEFORE INSERT ON mart_operations
WHEN NEW.actor_type = 'market_clerk' AND NOT EXISTS (
  SELECT 1 FROM mart_effective_market_clerks clerk
  WHERE clerk.class_id = NEW.class_id
    AND clerk.student_id = NEW.actor_student_id
    AND clerk.period_id = NEW.actor_job_period_id
)
BEGIN SELECT RAISE(ABORT, 'MART_CLERK_ACCESS_DENIED'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_operations_insert_correction_guard
BEFORE INSERT ON mart_operations
WHEN NEW.operation = 'inventory_correction'
  AND NEW.actor_type <> 'teacher'
BEGIN SELECT RAISE(ABORT, 'MART_INVENTORY_CORRECTION_TEACHER_REQUIRED'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_operations_update_guard
BEFORE UPDATE ON mart_operations
BEGIN SELECT RAISE(ABORT, 'MART_OPERATION_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_operations_delete_guard
BEFORE DELETE ON mart_operations
BEGIN SELECT RAISE(ABORT, 'MART_OPERATION_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_products_insert_guard
BEFORE INSERT ON mart_products
WHEN NOT EXISTS (
  SELECT 1 FROM mart_operations operation
  WHERE operation.id = NEW.created_operation_id
    AND operation.class_id = NEW.class_id
    AND operation.operation = 'product_create'
    AND operation.resource_id = NEW.id
)
BEGIN SELECT RAISE(ABORT, 'MART_PRODUCT_OPERATION_INVALID'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_products_update_guard
BEFORE UPDATE ON mart_products
WHEN NEW.id <> OLD.id OR NEW.class_id <> OLD.class_id
  OR NEW.created_operation_id <> OLD.created_operation_id
  OR NEW.created_at <> OLD.created_at
  OR NEW.revision <> OLD.revision + 1
  OR NOT EXISTS (
    SELECT 1 FROM mart_product_events event
    JOIN mart_operations operation ON operation.id = event.operation_id
    WHERE event.product_id = OLD.id
      AND event.class_id = OLD.class_id
      AND event.revision = NEW.revision
      AND event.action IN ('updated', 'activated', 'deactivated')
      AND operation.operation = 'product_update'
      AND operation.resource_id = OLD.id
  )
BEGIN SELECT RAISE(ABORT, 'MART_PRODUCT_STALE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_products_delete_guard
BEFORE DELETE ON mart_products
BEGIN SELECT RAISE(ABORT, 'MART_PRODUCT_DELETE_FORBIDDEN'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_inventory_insert_guard
BEFORE INSERT ON mart_inventory
WHEN NEW.quantity <> 0 OR NEW.revision <> 0
  OR NOT EXISTS (
    SELECT 1 FROM mart_products product
    WHERE product.id = NEW.product_id AND product.class_id = NEW.class_id
  )
BEGIN SELECT RAISE(ABORT, 'MART_INVENTORY_INITIAL_INVALID'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_inventory_update_guard
BEFORE UPDATE ON mart_inventory
WHEN NEW.product_id <> OLD.product_id OR NEW.class_id <> OLD.class_id
  OR NEW.created_at <> OLD.created_at
  OR NEW.revision <> OLD.revision + 1
  OR NOT EXISTS (
    SELECT 1 FROM mart_inventory_movements movement
    WHERE movement.product_id = OLD.product_id
      AND movement.class_id = OLD.class_id
      AND movement.inventory_revision_before = OLD.revision
      AND movement.inventory_revision_after = NEW.revision
      AND movement.quantity_before = OLD.quantity
      AND movement.quantity_after = NEW.quantity
  )
BEGIN SELECT RAISE(ABORT, 'MART_INVENTORY_STALE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_inventory_delete_guard
BEFORE DELETE ON mart_inventory
BEGIN SELECT RAISE(ABORT, 'MART_INVENTORY_DELETE_FORBIDDEN'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_product_events_insert_guard
BEFORE INSERT ON mart_product_events
WHEN NOT EXISTS (
  SELECT 1
  FROM mart_products product
  JOIN mart_operations operation
    ON operation.id = NEW.operation_id
   AND operation.class_id = NEW.class_id
  WHERE product.id = NEW.product_id AND product.class_id = NEW.class_id
    AND operation.resource_id = product.id
    AND (
      (NEW.action = 'created' AND NEW.revision = 0
        AND product.revision = 0 AND operation.operation = 'product_create')
      OR
      (NEW.action IN ('updated', 'activated', 'deactivated')
        AND NEW.revision = product.revision + 1
        AND operation.operation = 'product_update')
    )
)
BEGIN SELECT RAISE(ABORT, 'MART_PRODUCT_EVENT_INVALID'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_product_events_update_guard
BEFORE UPDATE ON mart_product_events
BEGIN SELECT RAISE(ABORT, 'MART_PRODUCT_EVENT_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_product_events_delete_guard
BEFORE DELETE ON mart_product_events
BEGIN SELECT RAISE(ABORT, 'MART_PRODUCT_EVENT_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sales_insert_guard
BEFORE INSERT ON mart_sales
WHEN NEW.status <> 'building' OR NEW.revision <> 0
  OR NOT EXISTS (
    SELECT 1 FROM mart_operations operation
    WHERE operation.id = NEW.created_operation_id
      AND operation.class_id = NEW.class_id
      AND operation.operation = 'sale_create'
      AND operation.resource_id = NEW.id
  )
  OR NOT EXISTS (
    SELECT 1 FROM students student
    WHERE student.id = NEW.buyer_student_id
      AND student.class_id = NEW.class_id
      AND student.status <> 'excluded'
      AND student.student_number = NEW.buyer_student_number_snapshot
      AND student.official_name = NEW.buyer_student_name_snapshot
  )
BEGIN SELECT RAISE(ABORT, 'MART_SALE_CONTEXT_INVALID'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sale_items_insert_guard
BEFORE INSERT ON mart_sale_items
WHEN NOT EXISTS (
  SELECT 1 FROM mart_sales sale
  JOIN mart_products product
    ON product.id = NEW.product_id AND product.class_id = NEW.class_id
  WHERE sale.id = NEW.sale_id AND sale.class_id = NEW.class_id
    AND sale.status = 'building'
    AND product.is_active = 1
    AND product.name = NEW.product_name_snapshot
    AND product.unit_price = NEW.unit_price_snapshot
)
BEGIN SELECT RAISE(ABORT, 'MART_SALE_ITEM_INVALID'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_inventory_movements_insert_guard
BEFORE INSERT ON mart_inventory_movements
WHEN NOT EXISTS (
  SELECT 1 FROM mart_inventory inventory
  JOIN mart_operations operation
    ON operation.id = NEW.operation_id
   AND operation.class_id = NEW.class_id
  WHERE inventory.product_id = NEW.product_id
    AND inventory.class_id = NEW.class_id
    AND inventory.quantity = NEW.quantity_before
    AND inventory.revision = NEW.inventory_revision_before
    AND NEW.quantity_after = inventory.quantity + NEW.delta
    AND NEW.inventory_revision_after = inventory.revision + 1
    AND (
      (NEW.movement_type = 'inbound'
        AND operation.operation = 'inventory_inbound'
        AND operation.resource_id = NEW.id AND NEW.delta > 0)
      OR
      (NEW.movement_type = 'outbound'
        AND operation.operation = 'inventory_outbound'
        AND operation.resource_id = NEW.id AND NEW.delta < 0)
      OR
      (NEW.movement_type = 'correction'
        AND operation.operation = 'inventory_correction'
        AND operation.resource_id = NEW.id)
      OR
      (NEW.movement_type = 'sale'
        AND operation.operation = 'sale_create'
        AND operation.resource_id = NEW.source_sale_id
        AND EXISTS (
          SELECT 1 FROM mart_sale_items item
          JOIN mart_sales sale ON sale.id = item.sale_id
          WHERE item.id = NEW.source_sale_item_id
            AND item.sale_id = NEW.source_sale_id
            AND item.class_id = NEW.class_id
            AND item.product_id = NEW.product_id
            AND sale.status = 'building'
            AND NEW.delta = -item.quantity
        ))
      OR
      (NEW.movement_type = 'sale_cancel'
        AND operation.operation = 'sale_cancel'
        AND operation.resource_id = NEW.source_sale_id
        AND EXISTS (
          SELECT 1 FROM mart_sale_items item
          JOIN mart_sales sale ON sale.id = item.sale_id
          JOIN mart_sale_cancellations cancellation
            ON cancellation.sale_id = sale.id
           AND cancellation.operation_id = NEW.operation_id
          WHERE item.id = NEW.source_sale_item_id
            AND item.sale_id = NEW.source_sale_id
            AND item.class_id = NEW.class_id
            AND item.product_id = NEW.product_id
            AND sale.status = 'posted'
            AND NEW.delta = item.quantity
        ))
    )
)
BEGIN SELECT RAISE(ABORT, 'MART_INVENTORY_STALE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_inventory_movements_apply
AFTER INSERT ON mart_inventory_movements
BEGIN UPDATE mart_inventory SET quantity = NEW.quantity_after, revision = NEW.inventory_revision_after, updated_at = NEW.created_at WHERE product_id = NEW.product_id AND class_id = NEW.class_id; END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_inventory_movements_update_guard
BEFORE UPDATE ON mart_inventory_movements
BEGIN SELECT RAISE(ABORT, 'MART_INVENTORY_MOVEMENT_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_inventory_movements_delete_guard
BEFORE DELETE ON mart_inventory_movements
BEGIN SELECT RAISE(ABORT, 'MART_INVENTORY_MOVEMENT_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sales_update_guard
BEFORE UPDATE ON mart_sales
WHEN NOT (
  OLD.status = 'building' AND NEW.status = 'posted'
  AND NEW.id = OLD.id AND NEW.class_id = OLD.class_id
  AND NEW.buyer_student_id = OLD.buyer_student_id
  AND NEW.buyer_student_number_snapshot = OLD.buyer_student_number_snapshot
  AND NEW.buyer_student_name_snapshot = OLD.buyer_student_name_snapshot
  AND NEW.total_amount = OLD.total_amount
  AND NEW.total_quantity = OLD.total_quantity
  AND NEW.revision = 0
  AND NEW.created_operation_id = OLD.created_operation_id
  AND NEW.cancelled_operation_id IS NULL
  AND NEW.cancelled_reason IS NULL AND NEW.cancelled_at IS NULL
  AND NEW.created_at = OLD.created_at
  AND EXISTS (SELECT 1 FROM mart_sale_items item WHERE item.sale_id = OLD.id)
  AND NEW.total_amount = (
    SELECT COALESCE(SUM(item.line_total), 0)
    FROM mart_sale_items item WHERE item.sale_id = OLD.id
  )
  AND NEW.total_quantity = (
    SELECT COALESCE(SUM(item.quantity), 0)
    FROM mart_sale_items item WHERE item.sale_id = OLD.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM mart_sale_items item
    WHERE item.sale_id = OLD.id AND NOT EXISTS (
      SELECT 1 FROM mart_inventory_movements movement
      WHERE movement.source_sale_item_id = item.id
        AND movement.source_sale_id = OLD.id
        AND movement.movement_type = 'sale'
        AND movement.operation_id = OLD.created_operation_id
        AND movement.delta = -item.quantity
    )
  )
)
AND NOT (
  OLD.status = 'posted' AND NEW.status = 'cancelled'
  AND NEW.id = OLD.id AND NEW.class_id = OLD.class_id
  AND NEW.buyer_student_id = OLD.buyer_student_id
  AND NEW.buyer_student_number_snapshot = OLD.buyer_student_number_snapshot
  AND NEW.buyer_student_name_snapshot = OLD.buyer_student_name_snapshot
  AND NEW.total_amount = OLD.total_amount
  AND NEW.total_quantity = OLD.total_quantity
  AND NEW.revision = OLD.revision + 1
  AND NEW.created_operation_id = OLD.created_operation_id
  AND NEW.created_at = OLD.created_at
  AND EXISTS (
    SELECT 1 FROM mart_sale_cancellations cancellation
    WHERE cancellation.sale_id = OLD.id
      AND cancellation.class_id = OLD.class_id
      AND cancellation.operation_id = NEW.cancelled_operation_id
      AND cancellation.expected_sale_revision = OLD.revision
      AND cancellation.reason = NEW.cancelled_reason
      AND cancellation.cancelled_at = NEW.cancelled_at
  )
  AND NOT EXISTS (
    SELECT 1 FROM mart_sale_items item
    WHERE item.sale_id = OLD.id AND NOT EXISTS (
      SELECT 1 FROM mart_inventory_movements movement
      WHERE movement.source_sale_item_id = item.id
        AND movement.source_sale_id = OLD.id
        AND movement.movement_type = 'sale_cancel'
        AND movement.operation_id = NEW.cancelled_operation_id
        AND movement.delta = item.quantity
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'MART_SALE_STALE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sales_delete_guard
BEFORE DELETE ON mart_sales
BEGIN SELECT RAISE(ABORT, 'MART_SALE_DELETE_FORBIDDEN'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sale_items_update_guard
BEFORE UPDATE ON mart_sale_items
BEGIN SELECT RAISE(ABORT, 'MART_SALE_ITEM_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sale_items_delete_guard
BEFORE DELETE ON mart_sale_items
BEGIN SELECT RAISE(ABORT, 'MART_SALE_ITEM_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sale_cancellations_insert_guard
BEFORE INSERT ON mart_sale_cancellations
WHEN NOT EXISTS (
  SELECT 1 FROM mart_sales sale
  JOIN mart_operations operation
    ON operation.id = NEW.operation_id
   AND operation.class_id = NEW.class_id
  WHERE sale.id = NEW.sale_id AND sale.class_id = NEW.class_id
    AND sale.status = 'posted'
    AND sale.revision = NEW.expected_sale_revision
    AND operation.operation = 'sale_cancel'
    AND operation.resource_id = sale.id
    AND operation.intervention_reason = NEW.reason
)
BEGIN SELECT RAISE(ABORT, 'MART_SALE_STALE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sale_cancellations_update_guard
BEFORE UPDATE ON mart_sale_cancellations
BEGIN SELECT RAISE(ABORT, 'MART_SALE_CANCELLATION_IMMUTABLE'); END;`,
  `CREATE TRIGGER IF NOT EXISTS mart_sale_cancellations_delete_guard
BEFORE DELETE ON mart_sale_cancellations
BEGIN SELECT RAISE(ABORT, 'MART_SALE_CANCELLATION_IMMUTABLE'); END;`,
] as const;
