module.exports = {
  apps: [
    {
      name: 'voxx-backend',
      interpreter: 'node',
      script: 'node_modules/.bin/tsx',
      args: 'server/index.ts --port=4300 --host=0.0.0.0',
      cwd: '/opt/beatrice',
      max_restarts: 10,
      min_uptime: 10000,
      restart_delay: 5000,
    },
    {
      name: 'voix-backend',
      interpreter: 'node',
      script: 'node_modules/.bin/tsx',
      args: 'server/index.ts --port=3076 --host=0.0.0.0',
      cwd: '/opt/voix',
      max_restarts: 10,
      min_uptime: 10000,
      restart_delay: 5000,
    },
    {
      name: 'api-eburon',
      interpreter: 'node',
      script: 'server.js',
      cwd: '/opt/api-eburon',
      max_restarts: 10,
      min_uptime: 10000,
      restart_delay: 5000,
    },
  ]
};
