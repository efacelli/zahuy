
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"changed_at": string,"changed_by": string | null,"id": number,"new_data": Json | null,"old_data": Json | null,"record_id": string,"table_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"changed_at"?: string,"changed_by"?: string | null,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id": string,"table_name": string
                  }
                  Update: {
                    "action"?: string,"changed_at"?: string,"changed_by"?: string | null,"id"?: never,"new_data"?: Json | null,"old_data"?: Json | null,"record_id"?: string,"table_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"brands": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"is_active": boolean,"name": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "brands_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "brands_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"is_active": boolean,"name": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categories_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"expiry_alert_settings": {
                  Row: {
                    "category_id": string | null,"created_at": string,"created_by": string | null,"id": string,"notice_days": number,"soon_days": number,"updated_at": string,"updated_by": string | null,"urgent_days": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notice_days"?: number,"soon_days"?: number,"updated_at"?: string,"updated_by"?: string | null,"urgent_days"?: number
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"notice_days"?: number,"soon_days"?: number,"updated_at"?: string,"updated_by"?: string | null,"urgent_days"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "expiry_alert_settings_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expiry_alert_settings_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "expiry_alert_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"product_batches": {
                  Row: {
                    "batch_number": string | null,"created_at": string,"created_by": string | null,"expires_on": string | null,"id": string,"notes": string | null,"product_id": string,"quantity_available": number,"quantity_initial": number,"received_on": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_number"?: string | null,"created_at"?: string,"created_by"?: string | null,"expires_on"?: string | null,"id"?: string,"notes"?: string | null,"product_id": string,"quantity_available": number,"quantity_initial": number,"received_on"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "batch_number"?: string | null,"created_at"?: string,"created_by"?: string | null,"expires_on"?: string | null,"id"?: string,"notes"?: string | null,"product_id"?: string,"quantity_available"?: number,"quantity_initial"?: number,"received_on"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_batches_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_batches_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "barcode": string | null,"boxes_quantity": number,"brand_id": string,"category_id": string,"cost_price": number,"created_at": string,"created_by": string | null,"creation_key": string | null,"description": string | null,"id": string,"image_path": string | null,"is_active": boolean,"min_stock": number,"name": string,"sale_price": number,"sale_price_with_vat": number | null,"sale_unit": Database["public"]['Enums']["sale_unit"],"sku": string,"supplier_id": string | null,"units_per_box": number,"updated_at": string,"updated_by": string | null,"vat_rate": number
                  }
                  ComputedFields: never
                  Insert: {
                    "barcode"?: string | null,"boxes_quantity"?: number,"brand_id": string,"category_id": string,"cost_price": number,"created_at"?: string,"created_by"?: string | null,"creation_key"?: string | null,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"min_stock"?: number,"name": string,"sale_price": number,"sale_price_with_vat"?: never,"sale_unit"?: Database["public"]['Enums']["sale_unit"],"sku"?: string,"supplier_id"?: string | null,"units_per_box"?: number,"updated_at"?: string,"updated_by"?: string | null,"vat_rate"?: number
                  }
                  Update: {
                    "barcode"?: string | null,"boxes_quantity"?: number,"brand_id"?: string,"category_id"?: string,"cost_price"?: number,"created_at"?: string,"created_by"?: string | null,"creation_key"?: string | null,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"min_stock"?: number,"name"?: string,"sale_price"?: number,"sale_price_with_vat"?: never,"sale_unit"?: Database["public"]['Enums']["sale_unit"],"sku"?: string,"supplier_id"?: string | null,"units_per_box"?: number,"updated_at"?: string,"updated_by"?: string | null,"vat_rate"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string,"id": string,"is_active": boolean,"role": Database["public"]['Enums']["app_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name": string,"id": string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"id"?: string,"is_active"?: boolean,"role"?: Database["public"]['Enums']["app_role"],"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"stock_movements": {
                  Row: {
                    "batch_id": string,"batch_quantity_after": number,"created_at": string,"created_by": string,"id": string,"idempotency_key": string,"movement_type": Database["public"]['Enums']["movement_type"],"notes": string | null,"occurred_at": string,"operation_key": string | null,"product_id": string,"quantity": number,"reason": string | null,"reverses_movement_id": string | null,"signed_quantity": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"batch_quantity_after": number,"created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key": string,"movement_type": Database["public"]['Enums']["movement_type"],"notes"?: string | null,"occurred_at"?: string,"operation_key"?: string | null,"product_id": string,"quantity": number,"reason"?: string | null,"reverses_movement_id"?: string | null,"signed_quantity"?: never
                  }
                  Update: {
                    "batch_id"?: string,"batch_quantity_after"?: number,"created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key"?: string,"movement_type"?: Database["public"]['Enums']["movement_type"],"notes"?: string | null,"occurred_at"?: string,"operation_key"?: string | null,"product_id"?: string,"quantity"?: number,"reason"?: string | null,"reverses_movement_id"?: string | null,"signed_quantity"?: never
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movements_batch_product_fkey"
      columns: ["batch_id","product_id"]
isOneToOne: false
      referencedRelation: "product_batches"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "stock_movements_batch_product_fkey"
      columns: ["batch_id","product_id"]
isOneToOne: false
      referencedRelation: "v_batch_status"
      referencedColumns: ["id","product_id"]
    },{
      foreignKeyName: "stock_movements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_movements_reverses_movement_id_fkey"
      columns: ["reverses_movement_id"]
isOneToOne: true
      referencedRelation: "stock_movements"
      referencedColumns: ["id"]
    }
                  ]
                },"suppliers": {
                  Row: {
                    "created_at": string,"created_by": string | null,"email": string | null,"id": string,"is_active": boolean,"name": string,"notes": string | null,"phone": string | null,"tax_id": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"notes"?: string | null,"phone"?: string | null,"tax_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"email"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"notes"?: string | null,"phone"?: string | null,"tax_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "suppliers_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "v_batch_status": {
                  Row: {
                    "batch_number": string | null,"category_id": string,"category_name": string,"created_at": string,"created_by": string | null,"days_to_expiry": number | null,"expires_on": string | null,"expiry_status": Database["public"]['Enums']["expiry_status"] | null,"id": string,"notes": string | null,"product_id": string,"product_is_active": boolean,"product_name": string,"product_sku": string,"quantity_available": number,"quantity_initial": number,"received_on": string,"sale_unit": Database["public"]['Enums']["sale_unit"],"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "product_batches_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "product_batches_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"v_inventory_summary": {
                  Row: {
                    "active_products": number | null,"box_mismatch_products": number | null,"expired_batches": number | null,"expiring_products": number | null,"low_stock_products": number | null,"shrinkage_quantity_month": number | null,"stock_value_cost": number | null,"stock_value_sale": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_product_list": {
                  Row: {
                    "active_batches_count": number | null,"barcode": string | null,"boxes_quantity": number,"brand_id": string,"brand_name": string,"category_id": string,"category_name": string,"cost_price": number,"created_at": string,"description": string | null,"has_box_mismatch": boolean | null,"id": string,"image_path": string | null,"is_active": boolean,"is_low_stock": boolean | null,"loose_units": number | null,"min_stock": number,"name": string,"next_expires_on": string | null,"next_expiry_status": Database["public"]['Enums']["expiry_status"] | null,"sale_price": number,"sale_price_with_vat": number | null,"sale_unit": Database["public"]['Enums']["sale_unit"],"sku": string,"stock_quantity": number | null,"supplier_id": string | null,"supplier_name": string | null,"units_in_boxes": number | null,"units_per_box": number,"updated_at": string,"vat_rate": number
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "products_brand_id_fkey"
      columns: ["brand_id"]
isOneToOne: false
      referencedRelation: "brands"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id"]
    }
                  ]
                },"v_product_stock": {
                  Row: {
                    "active_batches_count": number | null,"has_box_mismatch": boolean | null,"is_low_stock": boolean | null,"loose_units": number | null,"next_expires_on": string | null,"next_expiry_status": Database["public"]['Enums']["expiry_status"] | null,"product_id": string,"stock_quantity": number | null,"units_in_boxes": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "create_product":
{ Args: { "p_barcode"?: string,"p_batch_number"?: string,"p_boxes_quantity"?: number,"p_brand_id": string,"p_category_id": string,"p_cost_price": number,"p_description"?: string,"p_expires_on"?: string,"p_idempotency_key": string,"p_image_path"?: string,"p_initial_quantity"?: number,"p_is_active"?: boolean,"p_min_stock"?: number,"p_name": string,"p_received_on"?: string,"p_sale_price": number,"p_sale_unit": Database["public"]['Enums']["sale_unit"],"p_supplier_id"?: string,"p_units_per_box"?: number,"p_vat_rate": number }; Returns: {
              "barcode": string | null,
"boxes_quantity": number,
"brand_id": string,
"category_id": string,
"cost_price": number,
"created_at": string,
"created_by": string | null,
"creation_key": string | null,
"description": string | null,
"id": string,
"image_path": string | null,
"is_active": boolean,
"min_stock": number,
"name": string,
"sale_price": number,
"sale_price_with_vat": number | null,
"sale_unit": Database["public"]['Enums']["sale_unit"],
"sku": string,
"supplier_id": string | null,
"units_per_box": number,
"updated_at": string,
"updated_by": string | null,
"vat_rate": number
            }
                          SetofOptions: {
        from: "*"
        to: "products"
        isOneToOne: true
        isSetofReturn: false
      } },
"receive_stock":
{ Args: { "p_batch_number"?: string,"p_expires_on"?: string,"p_idempotency_key": string,"p_notes"?: string,"p_product_id": string,"p_quantity": number,"p_received_on"?: string }; Returns: {
              "batch_id": string,
"batch_quantity_after": number,
"created_at": string,
"created_by": string,
"id": string,
"idempotency_key": string,
"movement_type": Database["public"]['Enums']["movement_type"],
"notes": string | null,
"occurred_at": string,
"operation_key": string | null,
"product_id": string,
"quantity": number,
"reason": string | null,
"reverses_movement_id": string | null,
"signed_quantity": number | null
            }
                          SetofOptions: {
        from: "*"
        to: "stock_movements"
        isOneToOne: true
        isSetofReturn: false
      } },
"register_product_movement":
{ Args: { "p_idempotency_key": string,"p_movement_type": Database["public"]['Enums']["movement_type"],"p_notes"?: string,"p_occurred_at"?: string,"p_product_id": string,"p_quantity": number,"p_reason"?: string }; Returns: {
              "batch_id": string,
"batch_quantity_after": number,
"created_at": string,
"created_by": string,
"id": string,
"idempotency_key": string,
"movement_type": Database["public"]['Enums']["movement_type"],
"notes": string | null,
"occurred_at": string,
"operation_key": string | null,
"product_id": string,
"quantity": number,
"reason": string | null,
"reverses_movement_id": string | null,
"signed_quantity": number | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "stock_movements"
        isOneToOne: false
        isSetofReturn: true
      } },
"register_stock_movement":
{ Args: { "p_batch_id": string,"p_idempotency_key": string,"p_movement_type": Database["public"]['Enums']["movement_type"],"p_notes"?: string,"p_occurred_at"?: string,"p_quantity": number,"p_reason"?: string }; Returns: {
              "batch_id": string,
"batch_quantity_after": number,
"created_at": string,
"created_by": string,
"id": string,
"idempotency_key": string,
"movement_type": Database["public"]['Enums']["movement_type"],
"notes": string | null,
"occurred_at": string,
"operation_key": string | null,
"product_id": string,
"quantity": number,
"reason": string | null,
"reverses_movement_id": string | null,
"signed_quantity": number | null
            }
                          SetofOptions: {
        from: "*"
        to: "stock_movements"
        isOneToOne: true
        isSetofReturn: false
      } },
"reverse_stock_movement":
{ Args: { "p_idempotency_key": string,"p_movement_id": string,"p_reason": string }; Returns: {
              "batch_id": string,
"batch_quantity_after": number,
"created_at": string,
"created_by": string,
"id": string,
"idempotency_key": string,
"movement_type": Database["public"]['Enums']["movement_type"],
"notes": string | null,
"occurred_at": string,
"operation_key": string | null,
"product_id": string,
"quantity": number,
"reason": string | null,
"reverses_movement_id": string | null,
"signed_quantity": number | null
            }
                          SetofOptions: {
        from: "*"
        to: "stock_movements"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            "app_role": "admin"|"manager"|"staff","expiry_status": "depleted"|"no_expiry"|"expired"|"expires_urgent"|"expires_soon"|"expires_upcoming"|"ok","movement_type": "entry"|"exit"|"adjustment_in"|"adjustment_out"|"shrinkage"|"damage"|"customer_return"|"supplier_return"|"internal_use","sale_unit": "unit"|"kg"|"l"|"pack"|"box"|"other"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "app_role": ["admin", "manager", "staff"],"expiry_status": ["depleted", "no_expiry", "expired", "expires_urgent", "expires_soon", "expires_upcoming", "ok"],"movement_type": ["entry", "exit", "adjustment_in", "adjustment_out", "shrinkage", "damage", "customer_return", "supplier_return", "internal_use"],"sale_unit": ["unit", "kg", "l", "pack", "box", "other"]
          }
        }
} as const
