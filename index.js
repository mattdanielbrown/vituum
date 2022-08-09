import { defineConfig } from 'vite'
import { resolve, join, dirname } from 'path'
import os from 'os'
import FastGlob from 'fast-glob'
import lodash from 'lodash'
import chalk from 'chalk'
import autoprefixer from 'autoprefixer'
import postcssImport from 'postcss-import'
import postcssNesting from 'postcss-nesting'
import postcssCustomMedia from 'postcss-custom-media'
import postcssCustomSelectors from 'postcss-custom-selectors'
import posthtml from 'posthtml'
import posthtmlInclude from 'posthtml-include'
import posthtmlExtend from 'posthtml-extend'
import posthtmlExpressions from 'posthtml-expressions'
import juice from 'juice'
import fs from 'fs'
import run from 'vite-plugin-run'
import { tailwindAnimations, tailwindColorsAccent, tailwindColors, tailwindColorsCurrent, tailwindVariables } from './utils/tailwind.js'
import { supportedFormats } from './utils/common.js'

const optionalPlugin = {}

async function definePackage(plugin) {
    try {
        optionalPlugin[plugin] = (await import(plugin)).default
    } catch {}
}

await definePackage('tailwindcss')
await definePackage('tailwindcss/nesting/index.js')
await definePackage('vite-plugin-latte')
await definePackage('vite-plugin-twig')

const config = {
    input: ['./src/views/**/*.html', './src/styles/**/*.css', './src/scripts/**/*.js'],
    output: resolve(process.cwd(), 'public'),
    root: resolve(process.cwd(), 'src'),
    plugins: [],
    build: {
        log: false
    },
    server: {
        open: '/',
        https: false,
        cert: 'localhost',
        run: []
    },
    autoImport: {
        paths: ['styles/**/*.css', 'scripts/**/*.js'],
        filename: '+'
    },
    templates: {
        contentTypeJson: [],
        latte: {},
        twig: {},
        posthtml: {}
    },
    styles: {
        tailwindcss: true,
        postcss: {
            plugins: [postcssImport, postcssNesting, postcssCustomMedia, postcssCustomSelectors, autoprefixer]
        },
        juice: {
            paths: ['./src/emails'],
            options: {}
        }
    },
    emails: {
        send: {
            template: '',
            from: '',
            to: ''
        }
    },
    vite: {
        server: {
            host: true,
            fsServe: {
                strict: false
            }
        },
        build: {
            manifest: true,
            emptyOutDir: false,
            polyfillModulePreload: false
        }
    }
}

function userConfig(userConfig) {
    lodash.merge(config, userConfig)

    const middleware = {
        name: 'middleware',
        apply: 'serve',
        configureServer(viteDevServer) {
            return () => {
                viteDevServer.middlewares.use(async(req, res, next) => {
                    let format = null
                    let transformedUrl = req.originalUrl.replace('.html', '')

                    if (req.originalUrl === '/' || req.originalUrl.endsWith('/')) {
                        transformedUrl = transformedUrl + 'index'
                    }

                    if (!req.originalUrl.startsWith('/views') && !req.originalUrl.startsWith('/emails')) {
                        transformedUrl = '/views' + transformedUrl
                    }

                    supportedFormats.every(supportedFormat => {
                        if (fs.existsSync(join(viteDevServer.config.root, `${transformedUrl}.${supportedFormat}`)) || fs.existsSync(join(viteDevServer.config.root, `${transformedUrl}.${supportedFormat}.html`))) {
                            format = supportedFormat
                            return false
                        } else {
                            return true
                        }
                    })

                    if (format) {
                        transformedUrl = transformedUrl + `.${format}.html`
                    } else {
                        transformedUrl = transformedUrl + '.html'
                    }

                    if (fs.existsSync(join(viteDevServer.config.root, transformedUrl.replace('.html', ''))) && format) {
                        const output = await viteDevServer.transformIndexHtml(transformedUrl.replace('.html', ''), fs.readFileSync(join(viteDevServer.config.root, transformedUrl.replace('.html', ''))).toString())

                        if (transformedUrl.startsWith('/views/dialog')) {
                            res.setHeader('Content-Type', 'application/json')
                        } else {
                            res.setHeader('Content-Type', 'text/html')
                        }

                        res.statusCode = 200
                        res.end(output)
                    } else {
                        req.url = transformedUrl

                        next()
                    }
                })
            }
        }
    }

    const juicePlugin = (options = {}) => {
        return {
            name: 'vituum-plugin-juice',
            enforce: 'post',
            transformIndexHtml: {
                enforce: 'post',
                transform: (html, { path }) => {
                    if (!path.startsWith('/emails')) {
                        return html
                    }

                    html = html.replaceAll('<table', '<table border="0" cellpadding="0" cellspacing="0"')

                    return juice(html, options)
                }
            }
        }
    }

    const postHtmlPlugin = (params = {}) => {
        params = lodash.merge({
            options: {},
            locals: {},
            plugins: []
        }, params)

        return {
            name: 'vituum-plugin-posthtml',
            enforce: 'pre',
            transformIndexHtml: {
                enforce: 'pre',
                transform: async(html, { filename }) => {
                    const plugins = [
                        posthtmlExpressions({ locals: params.locals }),
                        posthtmlExtend({ encoding: 'utf8', root: dirname(filename) }),
                        posthtmlInclude({ encoding: 'utf8', root: dirname(filename) })
                    ]

                    const result = await posthtml(plugins.concat(...params.plugins)).process(html, params.options || {})

                    return result.html
                }
            }
        }
    }

    const plugins = [
        middleware,
        postHtmlPlugin(config.templates.posthtml),
        juicePlugin(config.styles.juice.options)
    ]

    if (optionalPlugin['vite-plugin-latte'] && config.templates.latte) {
        plugins.push(optionalPlugin['vite-plugin-latte'](lodash.merge({
            globals: {
                srcPath: resolve(process.cwd(), 'src')
            },
            data: './src/data/**/*.json'
        }, config.templates.latte)))
    } else {
        console.error(chalk.red('vite-plugin-latte not installed'))
    }

    if (optionalPlugin['vite-plugin-twig'] && config.templates.twig) {
        plugins.push(optionalPlugin['vite-plugin-twig'](lodash.merge({}, config.templates.twig)))
    } else {
        console.error(chalk.red('vite-plugin-twig not installed'))
    }

    if (config.styles.tailwindcss) {
        if (optionalPlugin.tailwindcss) {
            config.styles.postcss.plugins = [postcssImport, optionalPlugin['tailwindcss/nesting/index.js'](postcssNesting), postcssCustomMedia, postcssCustomSelectors, optionalPlugin.tailwindcss, autoprefixer]
        } else {
            console.error(chalk.red('tailwindcss not installed'))
        }
    }

    plugins.push(run(config.server.run))
    plugins.push(...plugins)

    if (config.server.https && fs.existsSync(join(os.homedir(), `.ssh/${config.server.cert}.pem`)) && fs.existsSync(join(os.homedir(), `.ssh/${config.server.cert}-key.pem`))) {
        config.vite.server = {
            https: {
                key: fs.readFileSync(join(os.homedir(), `.ssh/${config.server.cert}-key.pem`)),
                cert: fs.readFileSync(join(os.homedir(), `.ssh/${config.server.cert}.pem`))
            }
        }
    }

    return defineConfig(lodash.merge({
        vituum: config,
        plugins,
        resolve: {
            alias: {
                '/src': config.root
            }
        },
        root: config.root,
        publicDir: config.output,
        css: {
            postcss: config.styles.postcss
        },
        build: {
            outDir: config.output,
            rollupOptions: {
                input: FastGlob.sync(config.input).map(entry => resolve(process.cwd(), entry))
            }
        }
    }, config.vite))
}

export { userConfig as defineConfig, config, tailwindAnimations, tailwindColorsAccent, tailwindColors, tailwindColorsCurrent, tailwindVariables }
