import { readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const areas = [
  ['src/app', '应用协调和交互'], ['src/ui', '界面布局'], ['src/editor', '编辑器与中文命令'],
  ['src/documents', '文档模型与示例'], ['src/markdown', '排版和导出'], ['src/platform', '宿主通信'],
  ['src/features/updates', '更新界面与版本'], ['src/features/cloud', 'GitHub 登录与云文档界面'], ['src/styles', '视觉样式'],
  ['src/features/theme', '主题过渡'], ['src/features/images', '图片插入'],
  ['src/features/plugins', '自定义插件与隔离执行'],
  ['src/features/formulas', '可视化公式与 Office 复制'], ['src/features/html', 'HTML 编辑入口与隔离运行'],
  ['src/features/documents', '文档右键菜单与重命名'],
  ['native/Host', 'Windows 宿主'], ['native/Documents', 'Windows 文件与会话'],
  ['native/Infrastructure', 'Windows 路径与进程'], ['native/Export', 'Windows PDF'], ['native/Updates', 'Windows 更新'],
  ['native/Cloud', 'Windows GitHub 请求、凭据续期与云同步'],
  ['native/Preview', 'Windows HTML 运行与 Chrome 启动'],
  ['macos/App', 'macOS 应用'], ['macos/Host', 'macOS 资源宿主'], ['macos/Documents', 'macOS 文件与会话'],
  ['macos/Export', 'macOS PDF'], ['macos/Updates', 'macOS 更新'], ['macos/Diagnostics', 'macOS 实际运行验证'],
  ['macos/Cloud', 'macOS GitHub 请求、钥匙串凭据与云同步'],
  ['macos/Preview', 'macOS HTML 运行'],
  ['tests', '界面回归'], ['native-tests', '原生单元检查'], ['native-ui-tests', '真实 WebView2 交互'],
  ['native-pdf-tests', '真实 PDF 引擎'], ['installer', 'Windows 安装'], ['scripts', '开发脚本'],
  ['.github/workflows', '构建与发布'], ['public', '应用资源'], ['docs', '开发与发布记录'],
];
const groups = [];
for (const [path, purpose] of areas) {
  const entries = await readdir(join(root, path), { withFileTypes: true, recursive: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name).slice(root.length + 1).replaceAll('\\', '/'))
    .filter(file => !/(^|\/)(bin|obj|vendor)(\/|$)/.test(file)).sort();
  groups.push({ path, purpose, files });
}
const map = { guide: 'CODE_MAP.md', regenerate: 'npm run docs:map', entryPoints: ['index.html', 'src/app/main.ts', 'native/Program.cs', 'macos/App/Main.swift'], groups };
await writeFile(join(root, 'docs/code-map.json'), JSON.stringify(map, null, 2) + '\n');
console.log(`Saved docs/code-map.json: ${groups.reduce((count, group) => count + group.files.length, 0)} files in ${groups.length} areas`);
