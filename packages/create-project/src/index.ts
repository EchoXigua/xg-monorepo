import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import spawn from 'cross-spawn';
// minimist 是一个用于解析命令行参数的库。它能够将命令行中的参数转换成一个对象，方便程序根据这些参数做出不同的操作。
import minimist from 'minimist';
import prompts from 'prompts';
import {
  blue,
  cyan,
  green,
  lightGreen,
  magenta,
  red,
  reset,
  yellow,
} from 'kolorist';

const argv = minimist<{
  t?: string;
  template?: string;
  targetDir?: string;
  // string: ['_'] ，确保所有位置参数（不带 -- 的参数）被解析为字符串
}>(process.argv.slice(2), { string: ['_'] });
const cwd = process.cwd();

const INIT_CWD = process.env.INIT_CWD;

type ColorFunc = (str: string | number) => string;
type Framework = {
  name: string;
  display: string;
  color: ColorFunc;
  variants: FrameworkVariant[];
};
type FrameworkVariant = {
  name: string;
  display: string;
  color: ColorFunc;
  customCommand?: string;
};

const FRAMEWORKS: Framework[] = [
  {
    name: 'vue',
    display: 'Vue',
    color: green,
    variants: [
      {
        name: 'vue-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'vue',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'custom-create-vue',
        display: 'Customize with create-vue ↗',
        color: green,
        customCommand: 'npm create vue@latest TARGET_DIR',
      },
      {
        name: 'custom-nuxt',
        display: 'Nuxt ↗',
        color: lightGreen,
        customCommand: 'npm exec nuxi init TARGET_DIR',
      },
    ],
  },
  {
    name: 'react',
    display: 'React',
    color: cyan,
    variants: [
      {
        name: 'react-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'react-swc-ts',
        display: 'TypeScript + SWC',
        color: blue,
      },
      {
        name: 'react',
        display: 'JavaScript',
        color: yellow,
      },
      {
        name: 'react-swc',
        display: 'JavaScript + SWC',
        color: yellow,
      },
      {
        name: 'custom-remix',
        display: 'Remix ↗',
        color: cyan,
        customCommand: 'npm create remix@latest TARGET_DIR',
      },
    ],
  },
  {
    name: 'nest',
    color: magenta,
    display: 'Nest',
    variants: [],
  },
  {
    name: 'others',
    display: 'Others',
    color: reset,
    variants: [
      {
        name: 'create-vite-extra',
        display: 'create-vite-extra ↗',
        color: reset,
        customCommand: 'npm create vite-extra@latest TARGET_DIR',
      },
      {
        name: 'create-electron-vite',
        display: 'create-electron-vite ↗',
        color: reset,
        customCommand: 'npm create electron-vite@latest TARGET_DIR',
      },
    ],
  },
];

const TEMPLATES = FRAMEWORKS.map(
  (f) => (f.variants && f.variants.map((v) => v.name)) || [f.name],
).reduce((a, b) => a.concat(b), []);

const renameFiles: Record<string, string | undefined> = {
  _gitignore: '.gitignore',
};

const defaultTargetDir = 'xg-project';

async function init() {
  // 获取并格式化命令行中的第一个位置参数（即用户输入的目标目录）
  const argTargetDir = formatTargetDir(argv._[0]);
  // 获取命令行中传递的模板名称,如果用户指定了 --template 或 -t 参数，则优先使用其值
  const argTemplate = argv.template || argv.t;

  // 决定最终使用的目标目录
  let targetDir = argTargetDir || defaultTargetDir;
  const getProjectName = () =>
    targetDir === '.' ? path.basename(path.resolve()) : targetDir;

  let result: prompts.Answers<
    'projectName' | 'overwrite' | 'packageName' | 'framework' | 'variant'
  >;

  // 如果命令行中传递了 --overwrite 参数，则 prompts 中的 overwrite 问题将直接使用该值，而不会再询问用户
  prompts.override({
    overwrite: argv.overwrite,
  });

  try {
    // 使用 prompts 库进行用户交互
    result = await prompts(
      [
        {
          type: argTargetDir ? null : 'text',
          name: 'projectName',
          message: reset('Project name:'),
          initial: defaultTargetDir,
          onState: (state) => {
            targetDir = formatTargetDir(state.value) || defaultTargetDir;
          },
        },
        {
          type: () =>
            !fs.existsSync(targetDir) || isEmpty(targetDir) ? null : 'select',
          name: 'overwrite',
          message: () =>
            (targetDir === '.'
              ? 'Current directory'
              : `Target directory "${targetDir}"`) +
            ` is not empty. Please choose how to proceed:`,
          initial: 0,
          choices: [
            {
              title: 'Remove existing files and continue',
              value: 'yes',
            },
            {
              title: 'Cancel operation',
              value: 'no',
            },
            {
              title: 'Ignore files and continue',
              value: 'ignore',
            },
          ],
        },
        {
          type: (_, { overwrite }: { overwrite?: string }) => {
            if (overwrite === 'no') {
              throw new Error(red('✖') + ' Operation cancelled');
            }
            return null;
          },
          name: 'overwriteChecker',
        },
        {
          type: () => (isValidPackageName(getProjectName()) ? null : 'text'),
          name: 'packageName',
          message: reset('Package name:'),
          initial: () => toValidPackageName(getProjectName()),
          validate: (dir) =>
            isValidPackageName(dir) || 'Invalid package.json name',
        },
        {
          type:
            argTemplate && TEMPLATES.includes(argTemplate) ? null : 'select',
          name: 'framework',
          message:
            typeof argTemplate === 'string' && !TEMPLATES.includes(argTemplate)
              ? reset(
                  `"${argTemplate}" isn't a valid template. Please choose from below: `,
                )
              : reset('Select a framework:'),
          initial: 0,
          choices: FRAMEWORKS.map((framework) => {
            const frameworkColor = framework.color;
            return {
              title: frameworkColor(framework.display || framework.name),
              value: framework,
            };
          }),
        },
        {
          type: (framework: Framework) =>
            framework && framework.variants ? 'select' : null,
          name: 'variant',
          message: reset('Select a variant:'),
          choices: (framework: Framework) =>
            framework.variants.map((variant) => {
              const variantColor = variant.color;
              return {
                title: variantColor(variant.display || variant.name),
                value: variant.name,
              };
            }),
        },
      ],
      {
        onCancel: () => {
          throw new Error(red('✖') + ' Operation cancelled');
        },
      },
    );
  } catch (error: any) {
    console.log(error.message);
    return;
  }

  const { framework, overwrite, packageName, variant } = result;

  let root = path.join(cwd, targetDir);
  if (argv.targetDir && INIT_CWD) {
    root = path.join(INIT_CWD, argv.targetDir, targetDir);
  }
  console.log('root', root);

  // 处理目录存在，删除该目录下面的所有文件和目录
  if (overwrite === 'yes') {
    emptyDir(root);
  } else if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  let template: string = variant || framework?.name || argTemplate;
  let isReactSwc = false;
  if (template.includes('-swc')) {
    isReactSwc = true;
    template = template.replace('-swc', '');
  }

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent);

  const pkgManager = pkgInfo ? pkgInfo.name : 'npm';
  const isYarn1 = pkgManager === 'yarn' && pkgInfo?.version.startsWith('1.');

  const { customCommand } =
    FRAMEWORKS.flatMap((f) => f.variants).find((v) => v.name === template) ??
    {};

  if (customCommand) {
    // 处理自定义命令
    const fullCustomCommand = customCommand
      .replace(/^npm create /, () => {
        return `${pkgManager} create `;
      })
      // yarn 1 版本在 create 命令时不支持 @version
      .replace('@latest', () => (isYarn1 ? '' : '@latest'))
      .replace(/^npm exec/, () => {
        // 根据不同的包管理器自动调整命令的执行方式
        // Prefer `pnpm dlx`, `yarn dlx`, or `bun x`
        if (pkgManager === 'pnpm') {
          return 'pnpm dlx';
        }
        if (pkgManager === 'yarn' && !isYarn1) {
          return 'yarn dlx';
        }

        return 'npm exec';
      });

    // "npm"  ["install", "express"].
    const [command, ...args] = fullCustomCommand.split(' ');
    const replacedArgs = args.map((arg) =>
      arg.replace('TARGET_DIR', targetDir),
    );
    // 执行命令
    const { status } = spawn.sync(command, replacedArgs, {
      // 指定子进程的输入输出（stdio）应继承自父进程
      // 这意味着子进程的输出会直接显示在当前终端中，允许实时查看命令执行的结果
      stdio: 'inherit',
    });

    // 退出当前进程，如果 status 为 null 或 undefined，则使用默认退出码 0，表示成功退出
    process.exit(status ?? 0);
  }

  console.log(`\nScaffolding project in ${root}...`);

  const templateDir = path.resolve(
    // import.meta.url 当前模块文件的 URL，fileURLToPath 将模块的 URL 转换为文件系统路径
    fileURLToPath(import.meta.url),
    '../..',
    // 从当前模块文件的路径向上两级目录，然后进入 template-${template} 目录。
    `template-${template}`,
  );

  // 用于将文件写入到目标目录中
  const write = (file: string, content?: string) => {
    // 将目标根目录 root 与文件名拼接，生成目标文件的绝对路径。
    const targetPath = path.join(root, renameFiles[file] ?? file);
    if (content) {
      fs.writeFileSync(targetPath, content);
    } else {
      copy(path.join(templateDir, file), targetPath);
    }
  };

  // 同步读取模板目录中的所有文件和子目录，返回一个文件名数组
  const files = fs.readdirSync(templateDir);
  // 过滤掉 package.json 文件（因为它将被单独处理）
  for (const file of files.filter((f) => f !== 'package.json')) {
    write(file);
  }

  // 同步读取模板目录中的 package.json 文件内容
  const pkg = JSON.parse(
    fs.readFileSync(path.join(templateDir, `package.json`), 'utf-8'),
  );

  // 修改 package.json 文件中的 name 字段
  pkg.name = packageName || getProjectName();

  // 将修改后的 package.json 对象转换回 JSON 字符串并写入目标路径
  write('package.json', JSON.stringify(pkg, null, 2) + '\n');

  if (isReactSwc) {
    setupReactSwc(root, template.endsWith('-ts'));
  }

  const cdProjectName = argv.targetDir
    ? path.relative(INIT_CWD!, root)
    : path.relative(cwd, root);
  console.log(`\nDone. Now run:\n`);
  if (root !== cwd) {
    console.log(
      `  cd ${
        cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName
      }`,
    );
  }

  switch (pkgManager) {
    case 'yarn':
      console.log('  yarn');
      console.log('  yarn dev');
      break;
    default:
      console.log(`  ${pkgManager} install`);
      console.log(`  ${pkgManager} run dev`);
      break;
  }
}

// 格式化
function formatTargetDir(targetDir: string | undefined) {
  // 去除目标目录末尾的所有斜杠 /（可以是一个或多个）
  return targetDir?.trim().replace(/\/+$/g, '');
}

function isEmpty(path: string) {
  const files = fs.readdirSync(path);
  return files.length === 0 || (files.length === 1 && files[0] === '.git');
}

function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(
    projectName,
  );
}

function toValidPackageName(projectName: string) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-');
}

function emptyDir(dir: string) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const file of fs.readdirSync(dir)) {
    if (file === '.git') {
      continue;
    }
    // 递归强制删除目录
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true });
  }
}

function pkgFromUserAgent(userAgent: string | undefined) {
  if (!userAgent) return undefined;
  const pkgSpec = userAgent.split(' ')[0];
  const pkgSpecArr = pkgSpec.split('/');
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  };
}

function copy(src: string, dest: string) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dest);
  } else {
    fs.copyFileSync(src, dest);
  }
}
function copyDir(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file);
    const destFile = path.resolve(destDir, file);
    copy(srcFile, destFile);
  }
}

function setupReactSwc(root: string, isTs: boolean) {
  editFile(path.resolve(root, 'package.json'), (content) => {
    return content.replace(
      /"@vitejs\/plugin-react": ".+?"/,
      `"@vitejs/plugin-react-swc": "^3.5.0"`,
    );
  });
  editFile(
    path.resolve(root, `vite.config.${isTs ? 'ts' : 'js'}`),
    (content) => {
      return content.replace(
        '@vitejs/plugin-react',
        '@vitejs/plugin-react-swc',
      );
    },
  );
}

function editFile(file: string, callback: (content: string) => string) {
  const content = fs.readFileSync(file, 'utf-8');
  fs.writeFileSync(file, callback(content), 'utf-8');
}

init().catch((e) => console.log(e));
