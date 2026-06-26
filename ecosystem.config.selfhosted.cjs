module.exports = {
  apps: [
    {
      name: 'zero-selfhosted',
      script: 'node_modules/.bin/tsx',
      args: 'server/index.ts --port=4300 --host=0.0.0.0',
      cwd: '/opt/beatrice',
      max_restarts: 10,
      min_uptime: 10000,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: '4300',
        HOST: '0.0.0.0',
      },
    },
  ],
};
