# Quiniela CVA · Mundial 2026

Quiniela digital para los socios del club CVA. Cubre los **72 partidos de la
fase de grupos** del Mundial FIFA 2026 (12 grupos, A-L).

La aplicacion tiene dos portales:

- **Portal del socio** - el socio ingresa con un codigo, carga sus pronosticos
  y consulta resultados y posiciones.
- **Portal administrador** - gestiona socios, define la puntuacion, carga los
  resultados oficiales, abre o cierra la carga y consulta la tabla.

## Funcionalidades

### Administrador
1. Crear socios (nombre, apellido y numero de accion). Cada socio recibe un
   **codigo de acceso unico** y autogenerado.
2. Ver el listado de socios y la **tabla de posiciones** general.
3. Editar equipos y fechas, y **cargar los resultados** de cada partido.
4. Configurar la **puntuacion**: puntos por acertar el ganador y puntos por
   acertar el marcador exacto.
5. **Abrir o cerrar** la carga de pronosticos.
6. Ver y editar la quiniela de cualquier socio, y regenerar su codigo.

### Socio
1. Ingresar con su codigo para ver y **llenar su quiniela** (mientras la carga
   este abierta).
2. Consultar los **resultados** oficiales y la **tabla de posiciones**.

## Stack

- **Node.js + Express** - servidor web
- **EJS** - plantillas (sin paso de build)
- **PostgreSQL** - base de datos persistente

## Persistencia de datos (importante)

Los datos viven en **PostgreSQL**, un servicio independiente del contenedor de
la aplicacion. **Ningun deploy borra informacion:**

- Las migraciones usan `CREATE TABLE IF NOT EXISTS` (nunca eliminan tablas).
- La siembra inicial del torneo solo corre **una vez**, cuando la base esta
  vacia, y dentro de una transaccion (si un deploy se interrumpe, se revierte
  y se reintenta limpio en el siguiente arranque).
- Los pronosticos de los socios, los socios, los resultados y la configuracion
  se conservan entre deploys.

## Despliegue en Railway

1. Crea un proyecto en Railway y conecta este repositorio.
2. Agrega el plugin **PostgreSQL** (New -> Database -> PostgreSQL).
3. En el servicio de la aplicacion, configura las variables de entorno:
   - `DATABASE_URL` - referencia a `${{ Postgres.DATABASE_URL }}`
   - `ADMIN_PASSWORD` - la contrasena del portal administrador
   - `SESSION_SECRET` - una cadena larga y aleatoria
   - `DATABASE_SSL` - `false` si usas la URL interna del proyecto
4. Railway construye con Nixpacks y arranca con `npm start`. La base de datos
   se crea y se siembra automaticamente en el primer arranque.

> Mientras la app y la base esten en el **mismo proyecto** de Railway, usa la
> URL interna de Postgres y deja `DATABASE_SSL=false`. Si conectas a una URL
> publica de Postgres, pon `DATABASE_SSL=true`.

## Ejecucion local

```bash
npm install
cp .env.example .env   # edita los valores
npm start
```

Necesitas una base PostgreSQL accesible mediante `DATABASE_URL`. La app se
encarga de crear las tablas y sembrar el torneo en el primer arranque.

## Como se calcula la puntuacion

Para cada partido finalizado (con los dos marcadores cargados):

- **Marcador exacto** - el pronostico coincide exactamente: suma los puntos de
  "marcador exacto".
- **Solo el ganador** - el pronostico acierta quien gana o el empate, pero no
  el marcador: suma los puntos de "ganador".
- **Sin acierto** - 0 puntos.

Los empates en la tabla se resuelven por cantidad de marcadores exactos y luego
por aciertos de resultado.
