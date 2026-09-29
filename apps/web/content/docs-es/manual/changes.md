# Cambios

**Changes** responde a «¿qué ha cambiado?» en todo el espacio de trabajo.
Cada cambio se registra con quién lo hizo (una persona, un agente, una
importación o el sistema) y cuándo.

## Qué se registra

- Recursos y relaciones creados, editados, archivados o borrados.
- Sugerencias confirmadas o ignoradas.
- Equipos descubiertos por los agentes, y qué cambió en ellos desde el
  informe anterior: direcciones IP, servicios iniciados o detenidos,
  puertos en escucha abiertos o cerrados.
- Recursos que dejaron de observarse (**Stale**) y volvieron.
- Importaciones y sincronizaciones de integraciones.

## Consultar

- **Periodo**: últimas 24 horas, 7 días o 30 días.
- **Autor**: todos, personas, agentes o sistema.
- **Tipo**: pulsa una de las etiquetas de resumen (created, updated,
  discovered…) para filtrar.

Las entradas se agrupan por día y enlazan al recurso si todavía existe. La
página de cada recurso tiene además su propia pestaña **Activity**.

## Cuánto tiempo se guarda

En las instalaciones autoalojadas el historial de cambios se guarda 365
días. En InfraMole Cloud (previsto) dependerá del plan. El **registro de
auditoría** (eventos de seguridad), que es independiente, se describe en
[Miembros y seguridad](/es/docs/manual/members-and-security#registro-de-auditoria).
