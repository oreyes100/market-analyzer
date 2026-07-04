---
description: Inicio de sesión. Lee Contexto Activo y reporta estado mínimo.
---

Lee el archivo `.claude/memory/Contexto Activo.md` y responde en este formato exacto:

```
[YYYY-MM-DD] Market Analyzer — Listo.

Estado: [últimas tareas completadas o en curso — máx 1 línea cada una]
Bugs conocidos: [del Contexto Activo — solo los abiertos, o "ninguno"]
Próximo paso: [acción concreta según "Próximos Pasos — Prioridad"]
Stack: Express + vanilla JS | Deploy: Vercel | Puerto dev: 3117
```

Luego pregunta: "¿Continuamos con [próximo paso] o tienes otra prioridad?"

No cargues ningún otro archivo hasta que la tarea lo requiera.
