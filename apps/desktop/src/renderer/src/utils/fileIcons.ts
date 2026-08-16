const BASE_URL = 'https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@master/icons';

/**
 * `iconMap` comes from the active theme extension's `registerTheme` variables
 * (ThemeVariables.iconMap in @sde-code/sdk) — an icon-theme extension overrides
 * specific filenames/extensions and everything else falls through to the built-in
 * vscode-icons CDN set below, which itself falls back to a local Lucide-path SVG
 * on load failure (see FileTreeNode.tsx's TreeIcon).
 */
export const getFileIconUrl = (fileName: string, iconMap?: Record<string, string>): string => {
  const name = fileName.toLowerCase();
  const ext = name.split('.').pop() || '';

  if (iconMap) {
    if (iconMap[name]) return iconMap[name];
    if (iconMap[ext]) return iconMap[ext];
  }

  const filenameMap: Record<string, string> = {
    'package.json': 'file_type_npm.svg',
    'package-lock.json': 'file_type_npm.svg',
    'tsconfig.json': 'file_type_tsconfig.svg',
    'vite.config.ts': 'file_type_vite.svg',
    'vite.config.js': 'file_type_vite.svg',
    '.gitignore': 'file_type_git.svg',
    '.gitattributes': 'file_type_git.svg',
    '.env': 'file_type_settings.svg',
    '.env.local': 'file_type_settings.svg',
    '.env.development': 'file_type_settings.svg',
    '.env.production': 'file_type_settings.svg',
    '.eslintrc': 'file_type_eslint.svg',
    '.eslintrc.js': 'file_type_eslint.svg',
    '.eslintrc.json': 'file_type_eslint.svg',
    '.prettierrc': 'file_type_prettier.svg',
    '.prettierrc.json': 'file_type_prettier.svg',
    '.prettierrc.js': 'file_type_prettier.svg',
    'webpack.config.js': 'file_type_webpack.svg',
    'dockerfile': 'file_type_docker.svg',
    'docker-compose.yml': 'file_type_docker.svg',
    'cargo.toml': 'file_type_cargo.svg',
    'gemfile': 'file_type_bundler.svg',
    'makefile': 'file_type_makefile.svg',
  };

  if (filenameMap[name]) {
    return `${BASE_URL}/${filenameMap[name]}`;
  }

  const extensionMap: Record<string, string> = {
    js: 'file_type_js.svg',
    jsx: 'file_type_reactjs.svg',
    ts: 'file_type_typescript.svg',
    tsx: 'file_type_reactts.svg',
    html: 'file_type_html.svg',
    css: 'file_type_css.svg',
    scss: 'file_type_sass.svg',
    sass: 'file_type_sass.svg',
    less: 'file_type_less.svg',
    json: 'file_type_json.svg',
    md: 'file_type_markdown.svg',
    markdown: 'file_type_markdown.svg',
    py: 'file_type_python.svg',
    ipynb: 'file_type_text.svg',
    java: 'file_type_java.svg',
    class: 'file_type_java.svg',
    c: 'file_type_c.svg',
    cpp: 'file_type_cpp.svg',
    h: 'file_type_h.svg',
    hpp: 'file_type_hpp.svg',
    cs: 'file_type_csharp.svg',
    go: 'file_type_go.svg',
    rs: 'file_type_rust.svg',
    php: 'file_type_php.svg',
    rb: 'file_type_ruby.svg',
    pl: 'file_type_perl.svg',
    swift: 'file_type_swift.svg',
    kt: 'file_type_kotlin.svg',
    dart: 'file_type_dart.svg',
    sh: 'file_type_shell.svg',
    bat: 'file_type_shell.svg',
    cmd: 'file_type_shell.svg',
    ps1: 'file_type_powershell.svg',
    sql: 'file_type_sql.svg',
    xml: 'file_type_xml.svg',
    yaml: 'file_type_yaml.svg',
    yml: 'file_type_yaml.svg',
    ini: 'file_type_settings.svg',
    conf: 'file_type_settings.svg',
    cfg: 'file_type_settings.svg',
    toml: 'file_type_toml.svg',
    pdf: 'file_type_pdf.svg',
    svg: 'file_type_svg.svg',
    png: 'file_type_image.svg',
    jpg: 'file_type_image.svg',
    jpeg: 'file_type_image.svg',
    gif: 'file_type_image.svg',
    webp: 'file_type_image.svg',
    bmp: 'file_type_image.svg',
    ico: 'file_type_image.svg',
    mp3: 'file_type_audio.svg',
    wav: 'file_type_audio.svg',
    ogg: 'file_type_audio.svg',
    flac: 'file_type_audio.svg',
    mp4: 'file_type_video.svg',
    webm: 'file_type_video.svg',
    mkv: 'file_type_video.svg',
    avi: 'file_type_video.svg',
    mov: 'file_type_video.svg',
    zip: 'file_type_zip.svg',
    tar: 'file_type_zip.svg',
    gz: 'file_type_zip.svg',
    rar: 'file_type_zip.svg',
    '7z': 'file_type_zip.svg',
    txt: 'file_type_text.svg',
    log: 'file_type_text.svg',
  };

  const iconName = extensionMap[ext] || 'default_file.svg';
  return `${BASE_URL}/${iconName}`;
};

export const getFolderIconUrl = (folderName: string, isOpen: boolean): string => {
  const name = folderName.toLowerCase();
  
  const folderMap: Record<string, string> = {
    src: 'src',
    components: 'components',
    assets: 'assets',
    public: 'public',
    node_modules: 'node',
    git: 'git',
    '.git': 'git',
    dist: 'dist',
    build: 'dist',
    out: 'dist',
    config: 'config',
    '.vscode': 'vscode',
    test: 'test',
    tests: 'test',
    __tests__: 'test',
    views: 'views',
    pages: 'views',
    routes: 'routes',
    router: 'routes',
    controllers: 'controllers',
    services: 'services',
    models: 'models',
    styles: 'style',
    css: 'style',
    utils: 'utils',
    helpers: 'utils',
    api: 'api',
    hooks: 'hook',
    store: 'redux',
    redux: 'redux',
    actions: 'redux',
    reducers: 'redux',
    backend: 'folder_type_default', // standard folder but custom naming
    frontend: 'folder_type_default',
  };

  const folderKey = folderMap[name];
  if (folderKey && folderKey !== 'folder_type_default') {
    const suffix = isOpen ? '_opened' : '';
    return `${BASE_URL}/folder_type_${folderKey}${suffix}.svg`;
  }

  return isOpen 
    ? `${BASE_URL}/default_folder_opened.svg`
    : `${BASE_URL}/default_folder.svg`;
};
