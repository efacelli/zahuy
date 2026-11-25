# `daily-alerts`

Resumen diario de vencimientos al encargado, por **WhatsApp** (CallMeBot) y **email** (Resend). Decisión de
`efacelli` (2026-11-25): solo vencimientos, un mensaje por día a las 8:00.

- Lee `v_batch_status` (contrato §7.1) con la clave de servicio: lotes **vencidos con stock**, **urgentes**,
  **pronto** y **próximos**, con los días de alerta de cada categoría. Nunca agotados ni sin vencimiento.
- WhatsApp: hasta 8 productos por grupo y el enlace a Alertas. Email: la lista completa.
- Sin alertas no manda nada.
- La llama `.github/workflows/daily-alerts.yml` (11:00 UTC) con el encabezado `x-alerts-token`. Se puede
  disparar a mano desde Actions → «Alertas diarias» → Run workflow.
- `{"dryRun": true}` devuelve el texto del WhatsApp sin mandar nada.
- La respuesta dice cuántos mensajes salieron, nunca teléfonos ni mails.

## Secretos (Supabase → Edge Functions → Secrets; nunca en el repositorio)

| Secreto | Qué es |
|---|---|
| `ALERTS_CRON_TOKEN` | Token largo al azar; el mismo va en el secreto `ALERTS_CRON_TOKEN` de GitHub |
| `ALERTS_WHATSAPP` | `telefono:apikey` de CallMeBot, separados por coma (uno por encargado) |
| `RESEND_API_KEY` | Clave de Resend |
| `ALERTS_EMAIL_TO` | Mails del encargado, separados por coma |
| `ALERTS_EMAIL_FROM` | Opcional. Sin dominio propio verificado en Resend queda `onboarding@resend.dev`, que solo puede mandar al mail de la cuenta de Resend |

En GitHub (Settings → Secrets → Actions): `ALERTS_URL` (`https://<ref>.supabase.co/functions/v1/daily-alerts`)
y `ALERTS_CRON_TOKEN`.

## Activar WhatsApp (CallMeBot, gratis, no oficial)

Desde el WhatsApp de **cada** encargado: agendar el número que indica
<https://www.callmebot.com/blog/free-api-whatsapp-messages/> y mandarle «I allow callmebot to send me messages».
Responde con una `apikey`, que va en `ALERTS_WHATSAPP` junto al teléfono con código de país (por ejemplo
`+549385...`). Si CallMeBot deja de funcionar, el email sigue llegando.

## Pruebas

`npx -y deno@2.1.4 test --no-prompt --allow-env` en esta carpeta.
