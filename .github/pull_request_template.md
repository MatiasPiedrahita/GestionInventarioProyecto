## Historia de usuario
<!-- Ej: HU-01 Gestión de inventario de repuestos (dueño) -->

## Qué cambia
-

## Cómo probarlo
1. `npm ci` (y `npm run prediccion:instalar -- --dev` si el cambio toca la predicción)
2. `npm test` (y `npm run test:python` si el cambio toca el modelo)
3. `npm start` y abrir http://localhost:3000

## Lista de verificación del autor
- [ ] Las pruebas pasan localmente (`npm test`)
- [ ] El pipeline de CI está en verde
- [ ] No se suben contraseñas, tokens ni archivos `.env`
- [ ] El README sigue siendo válido con estos cambios

## Revisión
<!-- El revisor (otro integrante) comenta y aprueba desde "Files changed" > "Review changes" > "Approve" -->
