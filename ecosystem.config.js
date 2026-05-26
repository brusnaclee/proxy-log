module.exports = {
  apps: [
    {
      name: "proxy-api",
      script: "dist/index.js",
      cwd: "./packages/proxy",
      env: {
        NODE_ENV: "production",
      }
    },
    {
      name: "discord-bot",
      script: "src/index.js",
      cwd: "./packages/bot",
      env: {
        NODE_ENV: "production",
      }
    }
  ]
};
