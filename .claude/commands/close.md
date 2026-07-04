---
description: Cierre de sesión. Actualiza Contexto Activo y registra en sessions.jsonl.
---

1. Leer el historial completo de esta sesión.

2. Actualizar `.claude/memory/Contexto Activo.md`:
   - Mover "Última Sesión" actual a una sección de historial
   - Escribir la nueva "Última Sesión (YYYY-MM-DD, sesión N)" con lo completado hoy
   - Actualizar "Pendiente" con lo que quedó sin terminar
   - Actualizar "Próximos Pasos — Prioridad" con la acción concreta siguiente
   - Actualizar "Bugs Conocidos" si se abrió o cerró alguno
   - Actualizar la fecha al final del archivo

3. Si hubo una decisión arquitectónica nueva (fuente de datos, cambio de scoring, cambio de infraestructura de deploy):
   - Agregar entrada en `.claude/memory/Decision Journal.md` con formato: Contexto / Decisión / Por qué / Alternativa descartada / Estado (CERRADO).

4. Si se descubrió un quirk o error que otra sesión repetiría (comportamiento de una API externa, falso positivo de diagnóstico, etc.):
   - Agregar entrada en `.claude/memory/learned-rules.md` con formato: Trigger / Regla / Verify / sessions_ok: 0.

5. Registrar en `.claude/memory/sessions.jsonl` (append, una línea JSON):
   ```json
   {"date":"YYYY-MM-DD","session_n":N,"summary":"[1 línea: qué se hizo]","score":X}
   ```
   - `score` 1-10: 10 = tarea completada + verificada + sin bugs introducidos, 5 = avance parcial, 1 = solo exploración
   - Inferir `session_n` del número de líneas existentes en el archivo + 1

6. NO commitear como parte del cierre — regla de confirmación explícita en `CLAUDE.md` aplica igual.

7. Confirmar: "Sesión cerrada. Contexto persistido en Contexto Activo.md"
