# Dokploy Deployment

Use this skill when deploying this app (Beatrice) or any other service via **Dokploy** — the self-hosted open-source PaaS alternative to Vercel/Heroku.

## Installation (first-time VPS setup)

```bash
# SSH into the VPS
ssh root@168.231.78.113

# Install Dokploy (requires ports 80, 443, 3000 to be free)
# WARNING: Stops existing Traefik/nginx on those ports first
curl -sSL https://dokploy.com/install.sh | sh

# Access UI at http://168.231.78.113:3000
# Create admin account, then secure with domain + Let's Encrypt
```

**Prerequisites:** Docker, 2GB+ RAM, 30GB+ disk, Ubuntu/Debian.

## Deploying this app (Beatrice via Docker Compose)

Dokploy supports two methods:

### Method A: Docker Compose (recommended for this app)

1. In Dokploy UI → **Docker Compose** → **Create**
2. Set **Source** to **Git** → connect GitHub repo `lovegold120221-dot/xero`
3. Dokploy reads `docker-compose.dokploy.yml` from the repo
4. Set environment variables from `.env.example` in the Dokploy UI
5. Add domain `whatsapp.eburon.ai` and wait for SSL
6. Deploy

### Method B: Application (single service)

1. In Dokploy UI → **Application** → **Create**
2. Set **Source** to **Git** → same repo
3. Build: `Dockerfile` (already exists), Health check: `/api/health`
4. Expose port `4200`, domain `whatsapp.eburon.ai`
5. Set environment variables, deploy

## Migration from current PM2+Traefik setup

Current: PM2 runs `server/index.ts` via tsx on port 4200, Traefik reverse-proxies `whatsapp.eburon.ai`.

Migration steps:
1. Stop PM2: `pm2 stop voxx-backend && pm2 save`
2. Stop Traefik: `docker stop traefik` (Dokploy replaces it)
3. Install Dokploy (uses its own Traefik)
4. Create app in Dokploy UI, point to repo, set env vars
5. Health check passes → old setup is decommissioned

## Dokploy CLI

```bash
# Dokploy CLI is available on the server after installation
# Most management is done via the web UI at port 3000
```

## Key Dokploy Facts
- Uses Docker Swarm (not plain Docker Compose) under the hood
- Ports 80/443 managed by its own Traefik instance
- UI available on port 3000 initially
- Supports Let's Encrypt, Cloudflare, and custom certs
- Databases: MySQL, PostgreSQL, MongoDB, MariaDB, Redis
- Volume Backups to S3-compatible storage
- Can deploy from: GitHub, GitLab, Bitbucket, Gitea, Docker Hub
