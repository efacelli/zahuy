import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useToast } from '../../components/ui/toast-context'
import { toAppError } from '../../lib/errors'
import { useSupabase } from '../../lib/supabase-context'
import {
  ACCEPTED_IMAGE_TYPES,
  imageErrorMessage,
  prepareImage,
  productImageKey,
  removeProductImage,
  signedImageUrl,
  uploadProductImage,
  validateImageFile,
} from './product-image'
import styles from './ProductDetail.module.css'

interface Props {
  productId: string
  productName: string
  imagePath: string | null
  canEdit: boolean
}

/** Foto del producto en la ficha; el encargado y el dueño la suben, cambian o quitan. */
export function ProductImageCard({ productId, productName, imagePath, canEdit }: Props) {
  const client = useSupabase()
  const queryClient = useQueryClient()
  const toast = useToast()
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [broken, setBroken] = useState(false)

  const url = useQuery({
    queryKey: productImageKey(imagePath),
    queryFn: () => signedImageUrl(client, imagePath!),
    enabled: imagePath !== null,
    // La URL firmada vence a la hora: se renueva antes.
    staleTime: 45 * 60_000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['products'] })
  const message = (e: unknown) => imageErrorMessage(e, (x) => toAppError(x).message)

  const upload = useMutation({
    mutationFn: async (file: File) => uploadProductImage(client, productId, await prepareImage(file), imagePath),
    onSuccess: async () => {
      setBroken(false)
      await refresh()
      toast.success('Imagen guardada.')
    },
    onError: (e) => toast.error(message(e)),
  })

  const remove = useMutation({
    mutationFn: () => removeProductImage(client, productId, imagePath!),
    onSuccess: async () => {
      setConfirmRemove(false)
      await refresh()
      toast.success('Imagen quitada.')
    },
    onError: (e) => toast.error(message(e)),
  })

  function onFile(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    const invalid = validateImageFile(file)
    if (invalid) {
      toast.error(invalid)
      return
    }
    upload.mutate(file)
  }

  const busy = upload.isPending || remove.isPending

  return (
    <div className={`${styles.card} ${styles.imageCard}`}>
      <span className={styles.cardLabel}>Imagen</span>
      <div className={styles.imageFrame}>
        {imagePath === null ? (
          <span className={styles.muted}>Sin imagen</span>
        ) : url.data && !broken ? (
          <img src={url.data} alt={productName} className={styles.image} onError={() => setBroken(true)} />
        ) : (
          <span className={styles.muted}>{url.isError || broken ? 'No se pudo cargar la imagen' : 'Cargando…'}</span>
        )}
      </div>
      {canEdit && (
        <div className={styles.imageActions}>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            className="visually-hidden"
            aria-label={imagePath ? 'Cambiar imagen' : 'Subir imagen'}
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <Button disabled={busy} onClick={() => inputRef.current?.click()}>
            {upload.isPending ? 'Subiendo…' : imagePath ? 'Cambiar' : 'Subir imagen'}
          </Button>
          {imagePath && (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Quitar
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title="Quitar imagen"
        confirmLabel="Quitar imagen"
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmRemove(false)}
      >
        Se quita la foto de {productName}. Podés subir otra cuando quieras.
      </ConfirmDialog>
    </div>
  )
}
