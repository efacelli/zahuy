/**
 * Chequeo en tiempo de compilación: los enums del dominio (escritos a mano)
 * tienen que coincidir exactamente con los de la base (database.ts, generado con
 * `npm run gen:types`). Si alguien agrega o renombra un valor de un lado solo,
 * `tsc` falla acá. No genera código.
 */
import type { ExpiryStatus } from '../domain/expiry'
import type { MovementType } from '../domain/movements'
import type { AppRole } from '../domain/roles'
import type { SaleUnit } from '../domain/units'
import type { Database } from './database'

type DbEnums = Database['public']['Enums']

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

export type ContractCheck = [
  Assert<Same<MovementType, DbEnums['movement_type']>>,
  Assert<Same<SaleUnit, DbEnums['sale_unit']>>,
  Assert<Same<AppRole, DbEnums['app_role']>>,
  Assert<Same<ExpiryStatus, DbEnums['expiry_status']>>,
]
