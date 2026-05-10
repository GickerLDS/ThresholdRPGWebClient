module.exports = {
  apps: [
    {
      name: 'thresholdrpg-web-client',
      cwd: __dirname,
      script: './dist/server/index.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
