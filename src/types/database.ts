
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
                },"cash_registers": {
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
      foreignKeyName: "cash_registers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_registers_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cash_sessions": {
                  Row: {
                    "cash_register_id": string,"close_notes": string | null,"closed_at": string | null,"closed_by": string | null,"counted_cash": number | null,"created_at": string,"difference": number | null,"expected_cash": number | null,"id": string,"idempotency_key": string,"opened_at": string,"opened_by": string,"opening_amount": number,"status": Database["public"]['Enums']["cash_session_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "cash_register_id": string,"close_notes"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"counted_cash"?: number | null,"created_at"?: string,"difference"?: number | null,"expected_cash"?: number | null,"id"?: string,"idempotency_key": string,"opened_at"?: string,"opened_by"?: string,"opening_amount": number,"status"?: Database["public"]['Enums']["cash_session_status"]
                  }
                  Update: {
                    "cash_register_id"?: string,"close_notes"?: string | null,"closed_at"?: string | null,"closed_by"?: string | null,"counted_cash"?: number | null,"created_at"?: string,"difference"?: number | null,"expected_cash"?: number | null,"id"?: string,"idempotency_key"?: string,"opened_at"?: string,"opened_by"?: string,"opening_amount"?: number,"status"?: Database["public"]['Enums']["cash_session_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_sessions_cash_register_id_fkey"
      columns: ["cash_register_id"]
isOneToOne: false
      referencedRelation: "cash_registers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_sessions_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_sessions_opened_by_fkey"
      columns: ["opened_by"]
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
                },"payment_methods": {
                  Row: {
                    "code": string,"created_at": string,"created_by": string | null,"id": string,"is_active": boolean,"is_cash": boolean,"name": string,"sort_order": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"is_cash"?: boolean,"name": string,"sort_order"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_active"?: boolean,"is_cash"?: boolean,"name"?: string,"sort_order"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_methods_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_methods_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"price_bulk_changes": {
                  Row: {
                    "brand_ids": (string)[] | null,"category_ids": (string)[] | null,"created_at": string,"created_by": string,"excluded_product_ids": (string)[],"id": string,"idempotency_key": string,"notes": string | null,"percent": number,"product_ids": (string)[] | null,"products_count": number,"revert_idempotency_key": string | null,"revert_reason": string | null,"revert_result": Json | null,"reverted_at": string | null,"reverted_by": string | null,"rounding_multiple": number | null,"status": string,"supplier_ids": (string)[] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_ids"?: (string)[] | null,"category_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string,"excluded_product_ids"?: (string)[],"id"?: string,"idempotency_key": string,"notes"?: string | null,"percent": number,"product_ids"?: (string)[] | null,"products_count": number,"revert_idempotency_key"?: string | null,"revert_reason"?: string | null,"revert_result"?: Json | null,"reverted_at"?: string | null,"reverted_by"?: string | null,"rounding_multiple"?: number | null,"status"?: string,"supplier_ids"?: (string)[] | null
                  }
                  Update: {
                    "brand_ids"?: (string)[] | null,"category_ids"?: (string)[] | null,"created_at"?: string,"created_by"?: string,"excluded_product_ids"?: (string)[],"id"?: string,"idempotency_key"?: string,"notes"?: string | null,"percent"?: number,"product_ids"?: (string)[] | null,"products_count"?: number,"revert_idempotency_key"?: string | null,"revert_reason"?: string | null,"revert_result"?: Json | null,"reverted_at"?: string | null,"reverted_by"?: string | null,"rounding_multiple"?: number | null,"status"?: string,"supplier_ids"?: (string)[] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "price_bulk_changes_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_bulk_changes_reverted_by_fkey"
      columns: ["reverted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"price_history": {
                  Row: {
                    "bulk_change_id": string | null,"changed_at": string,"changed_by": string | null,"id": string,"new_cost_price": number,"new_sale_price": number,"old_cost_price": number,"old_sale_price": number,"product_id": string,"reason": string | null,"source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bulk_change_id"?: string | null,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_cost_price": number,"new_sale_price": number,"old_cost_price": number,"old_sale_price": number,"product_id": string,"reason"?: string | null,"source": string
                  }
                  Update: {
                    "bulk_change_id"?: string | null,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"new_cost_price"?: number,"new_sale_price"?: number,"old_cost_price"?: number,"old_sale_price"?: number,"product_id"?: string,"reason"?: string | null,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "price_history_bulk_change_id_fkey"
      columns: ["bulk_change_id"]
isOneToOne: false
      referencedRelation: "price_bulk_changes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_history_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_history_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_stock"
      referencedColumns: ["product_id"]
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
                    "barcode": string | null,"boxes_quantity": number,"brand_id": string,"category_id": string,"cost_price": number,"created_at": string,"created_by": string | null,"creation_key": string | null,"description": string | null,"id": string,"image_path": string | null,"is_active": boolean,"legacy_code": string | null,"min_stock": number,"name": string,"sale_price": number,"sale_price_with_vat": number | null,"sale_unit": Database["public"]['Enums']["sale_unit"],"search_name": string | null,"sku": string,"supplier_id": string | null,"units_per_box": number,"updated_at": string,"updated_by": string | null,"vat_rate": number
                  }
                  ComputedFields: never
                  Insert: {
                    "barcode"?: string | null,"boxes_quantity"?: number,"brand_id": string,"category_id": string,"cost_price": number,"created_at"?: string,"created_by"?: string | null,"creation_key"?: string | null,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"legacy_code"?: string | null,"min_stock"?: number,"name": string,"sale_price": number,"sale_price_with_vat"?: never,"sale_unit"?: Database["public"]['Enums']["sale_unit"],"search_name"?: never,"sku"?: string,"supplier_id"?: string | null,"units_per_box"?: number,"updated_at"?: string,"updated_by"?: string | null,"vat_rate"?: number
                  }
                  Update: {
                    "barcode"?: string | null,"boxes_quantity"?: number,"brand_id"?: string,"category_id"?: string,"cost_price"?: number,"created_at"?: string,"created_by"?: string | null,"creation_key"?: string | null,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"legacy_code"?: string | null,"min_stock"?: number,"name"?: string,"sale_price"?: number,"sale_price_with_vat"?: never,"sale_unit"?: Database["public"]['Enums']["sale_unit"],"search_name"?: never,"sku"?: string,"supplier_id"?: string | null,"units_per_box"?: number,"updated_at"?: string,"updated_by"?: string | null,"vat_rate"?: number
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
                },"sale_items": {
                  Row: {
                    "discount_amount": number,"discount_percent": number,"id": string,"line_total": number,"list_line_total": number,"net_amount": number,"product_id": string,"product_name": string,"product_sku": string,"quantity": number,"sale_id": string,"suggested_discount_percent": number,"unit_cost_price": number,"unit_price_with_vat": number,"vat_amount": number,"vat_rate": number
                  }
                  ComputedFields: never
                  Insert: {
                    "discount_amount"?: number,"discount_percent"?: number,"id"?: string,"line_total": number,"list_line_total": number,"net_amount": number,"product_id": string,"product_name": string,"product_sku": string,"quantity": number,"sale_id": string,"suggested_discount_percent"?: number,"unit_cost_price": number,"unit_price_with_vat": number,"vat_amount": number,"vat_rate": number
                  }
                  Update: {
                    "discount_amount"?: number,"discount_percent"?: number,"id"?: string,"line_total"?: number,"list_line_total"?: number,"net_amount"?: number,"product_id"?: string,"product_name"?: string,"product_sku"?: string,"quantity"?: number,"sale_id"?: string,"suggested_discount_percent"?: number,"unit_cost_price"?: number,"unit_price_with_vat"?: number,"vat_amount"?: number,"vat_rate"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_list"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "v_product_stock"
      referencedColumns: ["product_id"]
    },{
      foreignKeyName: "sale_items_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"sale_payments": {
                  Row: {
                    "amount": number,"id": string,"payment_method_id": string,"reference": string | null,"sale_id": string,"tendered_amount": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"id"?: string,"payment_method_id": string,"reference"?: string | null,"sale_id": string,"tendered_amount"?: number | null
                  }
                  Update: {
                    "amount"?: number,"id"?: string,"payment_method_id"?: string,"reference"?: string | null,"sale_id"?: string,"tendered_amount"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_payments_payment_method_id_fkey"
      columns: ["payment_method_id"]
isOneToOne: false
      referencedRelation: "payment_methods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_payments_payment_method_id_fkey"
      columns: ["payment_method_id"]
isOneToOne: false
      referencedRelation: "v_cash_session_payments"
      referencedColumns: ["payment_method_id"]
    },{
      foreignKeyName: "sale_payments_payment_method_id_fkey"
      columns: ["payment_method_id"]
isOneToOne: false
      referencedRelation: "v_sales_daily_payments"
      referencedColumns: ["payment_method_id"]
    },{
      foreignKeyName: "sale_payments_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    }
                  ]
                },"sales": {
                  Row: {
                    "cash_session_id": string,"created_at": string,"created_by": string,"discount_total": number,"id": string,"idempotency_key": string,"net_amount": number,"notes": string | null,"request_hash": string,"rounding_amount": number,"rounding_multiple": number,"sale_number": number,"status": Database["public"]['Enums']["sale_status"],"total_amount": number,"vat_amount": number,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cash_session_id": string,"created_at"?: string,"created_by"?: string,"discount_total"?: number,"id"?: string,"idempotency_key": string,"net_amount": number,"notes"?: string | null,"request_hash": string,"rounding_amount"?: number,"rounding_multiple": number,"sale_number"?: never,"status"?: Database["public"]['Enums']["sale_status"],"total_amount": number,"vat_amount": number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "cash_session_id"?: string,"created_at"?: string,"created_by"?: string,"discount_total"?: number,"id"?: string,"idempotency_key"?: string,"net_amount"?: number,"notes"?: string | null,"request_hash"?: string,"rounding_amount"?: number,"rounding_multiple"?: number,"sale_number"?: never,"status"?: Database["public"]['Enums']["sale_status"],"total_amount"?: number,"vat_amount"?: number,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_cash_session_id_fkey"
      columns: ["cash_session_id"]
isOneToOne: false
      referencedRelation: "cash_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_cash_session_id_fkey"
      columns: ["cash_session_id"]
isOneToOne: false
      referencedRelation: "v_cash_session_payments"
      referencedColumns: ["cash_session_id"]
    },{
      foreignKeyName: "sales_cash_session_id_fkey"
      columns: ["cash_session_id"]
isOneToOne: false
      referencedRelation: "v_cash_session_summary"
      referencedColumns: ["cash_session_id"]
    },{
      foreignKeyName: "sales_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"sales_settings": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"quantity_discount_max_percent": number,"quantity_discount_percent": number,"quantity_discount_step": number,"rounding_multiple": number,"store_address": string | null,"store_name": string | null,"store_tax_id": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"quantity_discount_max_percent"?: number,"quantity_discount_percent"?: number,"quantity_discount_step"?: number,"rounding_multiple"?: number,"store_address"?: string | null,"store_name"?: string | null,"store_tax_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"quantity_discount_max_percent"?: number,"quantity_discount_percent"?: number,"quantity_discount_step"?: number,"rounding_multiple"?: number,"store_address"?: string | null,"store_name"?: string | null,"store_tax_id"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_settings_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_movements": {
                  Row: {
                    "batch_id": string,"batch_quantity_after": number,"created_at": string,"created_by": string,"id": string,"idempotency_key": string,"movement_type": Database["public"]['Enums']["movement_type"],"notes": string | null,"occurred_at": string,"operation_key": string | null,"product_id": string,"quantity": number,"reason": string | null,"reverses_movement_id": string | null,"sale_item_id": string | null,"signed_quantity": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "batch_id": string,"batch_quantity_after": number,"created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key": string,"movement_type": Database["public"]['Enums']["movement_type"],"notes"?: string | null,"occurred_at"?: string,"operation_key"?: string | null,"product_id": string,"quantity": number,"reason"?: string | null,"reverses_movement_id"?: string | null,"sale_item_id"?: string | null,"signed_quantity"?: never
                  }
                  Update: {
                    "batch_id"?: string,"batch_quantity_after"?: number,"created_at"?: string,"created_by"?: string,"id"?: string,"idempotency_key"?: string,"movement_type"?: Database["public"]['Enums']["movement_type"],"notes"?: string | null,"occurred_at"?: string,"operation_key"?: string | null,"product_id"?: string,"quantity"?: number,"reason"?: string | null,"reverses_movement_id"?: string | null,"sale_item_id"?: string | null,"signed_quantity"?: never
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
    },{
      foreignKeyName: "stock_movements_sale_item_id_fkey"
      columns: ["sale_item_id"]
isOneToOne: false
      referencedRelation: "sale_items"
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
                },"v_cash_session_payments": {
                  Row: {
                    "amount_total": number | null,"cash_session_id": string,"payment_method_code": string,"payment_method_id": string,"payment_method_name": string,"payments_count": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_cash_session_summary": {
                  Row: {
                    "cash_collected": number | null,"cash_register_id": string,"cash_register_name": string,"cash_session_id": string,"closed_at": string | null,"closed_by": string | null,"counted_cash": number | null,"difference": number | null,"expected_cash": number | null,"opened_at": string,"opened_by": string,"opening_amount": number,"rounding_total": number | null,"sales_count": number | null,"sales_total": number | null,"status": Database["public"]['Enums']["cash_session_status"],"voided_count": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "cash_sessions_cash_register_id_fkey"
      columns: ["cash_register_id"]
isOneToOne: false
      referencedRelation: "cash_registers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_sessions_closed_by_fkey"
      columns: ["closed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_sessions_opened_by_fkey"
      columns: ["opened_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"v_inventory_summary": {
                  Row: {
                    "active_products": number | null,"box_mismatch_products": number | null,"expired_batches": number | null,"expiring_products": number | null,"low_stock_products": number | null,"shrinkage_quantity_month": number | null,"shrinkage_value_month": number | null,"stock_value_cost": number | null,"stock_value_sale": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_product_list": {
                  Row: {
                    "active_batches_count": number | null,"barcode": string | null,"boxes_quantity": number,"brand_id": string,"brand_name": string,"category_id": string,"category_name": string,"cost_price": number,"created_at": string,"description": string | null,"has_box_mismatch": boolean | null,"id": string,"image_path": string | null,"is_active": boolean,"is_low_stock": boolean | null,"legacy_code": string | null,"loose_units": number | null,"min_stock": number,"name": string,"next_expires_on": string | null,"next_expiry_status": Database["public"]['Enums']["expiry_status"] | null,"sale_price": number,"sale_price_with_vat": number | null,"sale_unit": Database["public"]['Enums']["sale_unit"],"search_name": string | null,"sku": string,"stock_quantity": number | null,"supplier_id": string | null,"supplier_name": string | null,"units_in_boxes": number | null,"units_per_box": number,"updated_at": string,"vat_rate": number
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
                },"v_sales_daily": {
                  Row: {
                    "cost_total": number | null,"discount_total": number | null,"gross_margin": number | null,"net_amount": number | null,"rounding_total": number | null,"sale_date": string | null,"sales_count": number | null,"total_amount": number | null,"vat_amount": number | null,"voided_count": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"v_sales_daily_payments": {
                  Row: {
                    "amount_total": number | null,"payment_method_code": string,"payment_method_id": string,"payment_method_name": string,"payments_count": number | null,"sale_date": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "apply_price_increase":
{ Args: { "p_brand_ids": (string)[],"p_category_ids": (string)[],"p_excluded_product_ids"?: (string)[],"p_idempotency_key": string,"p_notes"?: string,"p_percent": number,"p_product_ids": (string)[],"p_rounding_multiple"?: number,"p_supplier_ids": (string)[] }; Returns: {
              "brand_ids": (string)[] | null,
"category_ids": (string)[] | null,
"created_at": string,
"created_by": string,
"excluded_product_ids": (string)[],
"id": string,
"idempotency_key": string,
"notes": string | null,
"percent": number,
"product_ids": (string)[] | null,
"products_count": number,
"revert_idempotency_key": string | null,
"revert_reason": string | null,
"revert_result": Json | null,
"reverted_at": string | null,
"reverted_by": string | null,
"rounding_multiple": number | null,
"status": string,
"supplier_ids": (string)[] | null
            }
                          SetofOptions: {
        from: "*"
        to: "price_bulk_changes"
        isOneToOne: true
        isSetofReturn: false
      } },
"close_cash_session":
{ Args: { "p_cash_session_id": string,"p_close_notes"?: string,"p_counted_cash": number }; Returns: {
              "cash_register_id": string,
"close_notes": string | null,
"closed_at": string | null,
"closed_by": string | null,
"counted_cash": number | null,
"created_at": string,
"difference": number | null,
"expected_cash": number | null,
"id": string,
"idempotency_key": string,
"opened_at": string,
"opened_by": string,
"opening_amount": number,
"status": Database["public"]['Enums']["cash_session_status"]
            }
                          SetofOptions: {
        from: "*"
        to: "cash_sessions"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_product":
{ Args: { "p_barcode"?: string,"p_batch_number"?: string,"p_boxes_quantity"?: number,"p_brand_id": string,"p_category_id": string,"p_cost_price": number,"p_description"?: string,"p_expires_on"?: string,"p_idempotency_key": string,"p_image_path"?: string,"p_initial_quantity"?: number,"p_is_active"?: boolean,"p_legacy_code"?: string,"p_min_stock"?: number,"p_name": string,"p_received_on"?: string,"p_sale_price": number,"p_sale_unit": Database["public"]['Enums']["sale_unit"],"p_supplier_id"?: string,"p_units_per_box"?: number,"p_vat_rate": number }; Returns: {
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
"legacy_code": string | null,
"min_stock": number,
"name": string,
"sale_price": number,
"sale_price_with_vat": number | null,
"sale_unit": Database["public"]['Enums']["sale_unit"],
"search_name": string | null,
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
"open_cash_session":
{ Args: { "p_cash_register_id": string,"p_idempotency_key": string,"p_opening_amount": number }; Returns: {
              "cash_register_id": string,
"close_notes": string | null,
"closed_at": string | null,
"closed_by": string | null,
"counted_cash": number | null,
"created_at": string,
"difference": number | null,
"expected_cash": number | null,
"id": string,
"idempotency_key": string,
"opened_at": string,
"opened_by": string,
"opening_amount": number,
"status": Database["public"]['Enums']["cash_session_status"]
            }
                          SetofOptions: {
        from: "*"
        to: "cash_sessions"
        isOneToOne: true
        isSetofReturn: false
      } },
"preview_price_increase":
{ Args: { "p_brand_ids": (string)[],"p_category_ids": (string)[],"p_percent": number,"p_product_ids": (string)[],"p_rounding_multiple"?: number,"p_supplier_ids": (string)[] }; Returns: {
              "brand_name": string,"category_name": string,"change_amount": number,"name": string,"new_price_with_vat": number,"new_sale_price": number,"old_price_with_vat": number,"old_sale_price": number,"product_id": string,"sku": string,"supplier_name": string
            }[]
                           },
"product_sales_ranking":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "brand_name": string,"category_name": string,"cost_total": number,"gross_margin": number,"last_sold_at": string,"name": string,"net_total": number,"product_created_at": string,"product_id": string,"quantity_sold": number,"revenue_total": number,"sale_unit": Database["public"]['Enums']["sale_unit"],"sales_count": number,"sku": string,"stock_quantity": number,"supplier_name": string
            }[]
                           },
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
"sale_item_id": string | null,
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
"sale_item_id": string | null,
"signed_quantity": number | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "stock_movements"
        isOneToOne: false
        isSetofReturn: true
      } },
"register_sale":
{ Args: { "p_cash_session_id": string,"p_idempotency_key": string,"p_items": Json,"p_notes"?: string,"p_payments": Json }; Returns: {
              "cash_session_id": string,
"created_at": string,
"created_by": string,
"discount_total": number,
"id": string,
"idempotency_key": string,
"net_amount": number,
"notes": string | null,
"request_hash": string,
"rounding_amount": number,
"rounding_multiple": number,
"sale_number": number,
"status": Database["public"]['Enums']["sale_status"],
"total_amount": number,
"vat_amount": number,
"void_reason": string | null,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "sales"
        isOneToOne: true
        isSetofReturn: false
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
"sale_item_id": string | null,
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
"sale_item_id": string | null,
"signed_quantity": number | null
            }
                          SetofOptions: {
        from: "*"
        to: "stock_movements"
        isOneToOne: true
        isSetofReturn: false
      } },
"revert_price_change":
{ Args: { "p_bulk_change_id": string,"p_idempotency_key": string,"p_reason": string }; Returns: Json
                           },
"void_sale":
{ Args: { "p_idempotency_key": string,"p_reason": string,"p_sale_id": string }; Returns: {
              "cash_session_id": string,
"created_at": string,
"created_by": string,
"discount_total": number,
"id": string,
"idempotency_key": string,
"net_amount": number,
"notes": string | null,
"request_hash": string,
"rounding_amount": number,
"rounding_multiple": number,
"sale_number": number,
"status": Database["public"]['Enums']["sale_status"],
"total_amount": number,
"vat_amount": number,
"void_reason": string | null,
"voided_at": string | null,
"voided_by": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "sales"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            "app_role": "admin"|"manager"|"staff"|"developer","cash_session_status": "open"|"closed","expiry_status": "depleted"|"no_expiry"|"expired"|"expires_urgent"|"expires_soon"|"expires_upcoming"|"ok","movement_type": "entry"|"exit"|"adjustment_in"|"adjustment_out"|"shrinkage"|"damage"|"customer_return"|"supplier_return"|"internal_use"|"sale","sale_status": "completed"|"voided","sale_unit": "unit"|"kg"|"l"|"pack"|"box"|"other"
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
            "app_role": ["admin", "manager", "staff", "developer"],"cash_session_status": ["open", "closed"],"expiry_status": ["depleted", "no_expiry", "expired", "expires_urgent", "expires_soon", "expires_upcoming", "ok"],"movement_type": ["entry", "exit", "adjustment_in", "adjustment_out", "shrinkage", "damage", "customer_return", "supplier_return", "internal_use", "sale"],"sale_status": ["completed", "voided"],"sale_unit": ["unit", "kg", "l", "pack", "box", "other"]
          }
        }
} as const
