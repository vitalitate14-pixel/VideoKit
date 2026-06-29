# Electron 自动更新与打包规范

1. **版本号更新流程**：
   - 升级版本号时，必须同步修改 `package.json` 和 `package-lock.json` 中的 `version` 字段。
   - 必须先将修改后的代码和配置文件（如 `.github/workflows/build.yml`）提交并推送到 GitHub 主分支，**之后**再打 Tag（如 `v4.4.6`）并推送到 GitHub，以确保 GitHub Actions 构建的是最新修改后的代码。

2. **GitHub Actions 产物上传规范**：
   - 打包发布时，必须确保 `.github/workflows/build.yml` 的 `upload-artifact` 步骤中包含更新配置文件，否则自动更新检测机制将无法在 GitHub Release 中获取最新版本元数据导致自动更新失效：
     - macOS：必须包含 `dist-electron/latest-mac.yml`
     - Windows：必须包含 `dist-electron/latest.yml`
     - Linux：必须包含 `dist-electron/latest-linux.yml` 和 `dist-electron/latest-linux-arm64.yml`
