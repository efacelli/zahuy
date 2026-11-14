import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '../../components/ui/Button'
import { FormField } from '../../components/ui/FormField'
import { describedBy } from '../../components/ui/form-field-ids'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import {
  catalogFormSchema,
  emptyCatalogForm,
  type CatalogFormValues,
  type CatalogInfo,
  type CatalogRow,
} from './catalog-config'
import styles from './Catalogs.module.css'

interface CatalogFormModalProps {
  info: CatalogInfo
  /** `null` = alta; con fila = edición. */
  row: CatalogRow | null
  open: boolean
  busy: boolean
  serverError: string | null
  onSubmit: (values: Record<string, string | null>) => void
  onClose: () => void
}

export function CatalogFormModal(props: CatalogFormModalProps) {
  // Se vuelve a montar en cada apertura para arrancar con los valores de la fila.
  if (!props.open) return null
  return <CatalogFormModalContent {...props} />
}

function CatalogFormModalContent({ info, row, busy, serverError, onSubmit, onClose }: CatalogFormModalProps) {
  const [formId] = useState(() => `catalog-form-${info.kind}`)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CatalogFormValues, unknown, Record<string, string | null>>({
    resolver: zodResolver(catalogFormSchema(info)),
    defaultValues: emptyCatalogForm(row),
  })

  const isSupplier = info.kind === 'suppliers'
  const title = row ? `Editar ${info.singular}` : `Nueva ${info.singular}`.replace('Nueva proveedor', 'Nuevo proveedor')
  const err = (name: keyof CatalogFormValues) => errors[name]?.message
  const field = (name: keyof CatalogFormValues, hint?: string) => ({
    id: `catalog-${name}`,
    'aria-invalid': err(name) ? true : undefined,
    'aria-describedby': describedBy(`catalog-${name}`, { hint, error: err(name) }),
  })

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        {serverError && (
          <p className={styles.serverError} role="alert">
            <Icon name="error" size={18} /> {serverError}
          </p>
        )}
        <FormField label="Nombre" htmlFor="catalog-name" required error={err('name')}>
          <input className="input" autoComplete="off" {...field('name')} {...register('name')} />
        </FormField>
        {isSupplier && (
          <>
            <FormField label="CUIT" htmlFor="catalog-tax_id" error={err('tax_id')} hint="11 números; los guiones son opcionales.">
              <input
                className="input"
                inputMode="numeric"
                autoComplete="off"
                placeholder="30-12345678-9"
                {...field('tax_id', '11 números; los guiones son opcionales.')}
                {...register('tax_id')}
              />
            </FormField>
            <FormField label="Teléfono" htmlFor="catalog-phone" error={err('phone')}>
              <input className="input" type="tel" autoComplete="off" {...field('phone')} {...register('phone')} />
            </FormField>
            <FormField label="Email" htmlFor="catalog-email" error={err('email')}>
              <input className="input" type="email" autoComplete="off" {...field('email')} {...register('email')} />
            </FormField>
            <FormField label="Notas" htmlFor="catalog-notes" error={err('notes')} hint="Por ejemplo, días de pedido o de entrega.">
              <textarea className="textarea" rows={3} {...field('notes', 'Por ejemplo, días de pedido o de entrega.')} {...register('notes')} />
            </FormField>
          </>
        )}
      </form>
    </Modal>
  )
}
