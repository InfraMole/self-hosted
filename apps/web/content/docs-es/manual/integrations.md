# Integraciones en la nube

Las integraciones mantienen InfraMole sincronizado con **Azure**, **AWS** y
**Cloudflare** usando credenciales de API de solo lectura. Las gestionan los
admins y owners del espacio de trabajo en **Settings › Integrations**.

:::note Cómo se protegen las credenciales
Las credenciales se cifran en reposo (AES-256-GCM) en cuanto las guardas y
no se vuelven a mostrar. InfraMole solo llama a API de lectura. Da a cada
integración los permisos **mínimos** que se indican abajo — nada más.
:::

:::steps

### Crea una credencial de solo lectura

:::tabs
@tab Azure

1. En el portal de Azure: **Microsoft Entra ID › App registrations › New
   registration** (por ejemplo `inframole-reader`).
2. **Certificates & secrets › New client secret**. Copia el valor.
3. En la suscripción: **Access control (IAM) › Add role assignment ›
   Reader**, asignado a la aplicación.

Necesitarás el **tenant id**, el **subscription id**, el **client id** y el
**client secret**.
@tab AWS

1. En IAM, crea un usuario dedicado (sin acceso a la consola).
2. Adjúntale esta política en línea:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["ec2:DescribeInstances", "rds:DescribeDBInstances"],
         "Resource": "*"
       }
     ]
   }
   ```

3. Crea una clave de acceso para él.

Necesitarás la **región**, el **access key id** y el **secret access key**.
Una integración cubre una región.
@tab Cloudflare

1. **My Profile › API Tokens › Create Token › Custom token**.
2. Permisos: **Zone · Zone · Read** y **Zone · DNS · Read**.
3. Recursos de zona: las zonas que quieras (o todas).

Usa un **token** de API, nunca la clave global de API.
:::

### Añade la integración

En **Settings › Integrations › Add integration**, elige el proveedor, dale
un nombre, elige cada cuánto se sincroniza (cada 6 horas por defecto, de 1
hora a 7 días) y pega los valores. Opcionalmente, en Cloudflare, indica las
zonas que se importan (vacío = todas).

### Lanza la primera sincronización

Pulsa **Sync now**. El resultado indica qué se creó, qué se actualizó y qué
ya no aparece. A partir de ahí, la integración se sincroniza según su
calendario. En las instalaciones autoalojadas, las sincronizaciones
programadas necesitan `CRON_SECRET` (lo rellena `gen-secrets`).

:::

## Qué se importa

| Proveedor  | Recursos                                                                                     | Relaciones                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure      | Máquinas virtuales con IP privadas / públicas, tamaño, región, sistema operativo y etiquetas | —                                                                                                                                                                           |
| AWS        | Instancias EC2 (etiqueta Name, IP, plataforma) y bases de datos RDS                          | —                                                                                                                                                                           |
| Cloudflare | Registros A / AAAA / CNAME como dominios; un servicio externo `Cloudflare`                   | Los registros con proxy quedan _exposed through_ Cloudflare; un registro _depends on_ el recurso dueño de su IP de origen (solo si hay exactamente uno); CNAME → su destino |

Los recursos importados empiezan como **Discovered**. Las etiquetas
llamadas `env` o `environment` fijan el entorno.

## Cuando algo desaparece

Si una sincronización posterior ya no lista algo que creó la integración,
ese recurso pasa a **Stale** — no se borra. Si vuelve, recupera su estado.
Como red de seguridad, si una sincronización fuera a marcar como Stale más
de la mitad de los recursos de una integración (por ejemplo, tras una
respuesta parcial de la API), no se marca nada y el mensaje de la
sincronización lo indica.

## Eliminar una integración

**Delete** pregunta si también quieres retirar lo que creó: los recursos sin
tocar se borran, y los que tienen notas, ediciones o relaciones confirmadas
se archivan. Los recursos que ya existían antes nunca se tocan.
