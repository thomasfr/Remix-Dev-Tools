import { Plugin } from "vite";
import { parse } from "es-module-lexer";

import { cutArrayToLastN } from "../utils/common.js";
import { handleGoToSource } from "../../dev-server/init.js";
import { DevToolsServerConfig } from "../../dev-server/config.js";
import { handleDevToolsViteRequest, processPlugins } from "./utils.js";
import { ActionEvent, LoaderEvent } from "../../dev-server/event-queue.js";
import { diffInMs } from "../../dev-server/perf.js"
import chalk from "chalk"
import { OutgoingHttpHeader } from "node:http"

const routeInfo = new Map<string, { loader: LoaderEvent[]; action: ActionEvent[] }>();

export const remixDevTools: (args?: {
  pluginDir?: string;
  server?: Omit<DevToolsServerConfig, "wsPort" | "withWebsocket">;
}) => Plugin[] = (args) => {
  const serverConfig = args?.server || {};
  const pluginDir = args?.pluginDir || undefined;
  const plugins = pluginDir ? processPlugins(pluginDir) : [];
  const pluginNames = plugins.map((p) => p.name);
  let port = 5173;
  return [
    {
      enforce: "post",
      name: "remix-development-tools-server",
      apply(config) {
        return config.mode === "development";
      },
      transform(code) {
        if (code.includes("__REMIX_DEVELOPMENT_TOOL_SERVER_PORT__")) {
          const modified = code
            .replaceAll("__REMIX_DEVELOPMENT_TOOL_SERVER_PORT__", port.toString())
            .replaceAll(`singleton("config", () => ({}));`, `(${JSON.stringify(serverConfig)})`);
          return modified;
        }
      },
      configureServer(server) {
        server.httpServer?.on("listening", () => {
          port = server.config.server.port ?? 5173;
        });
        server.middlewares.use((req, res, next) =>
          handleDevToolsViteRequest(req, res, next, (parsedData) => {
            const { type, data } = parsedData;
            const id = data.id;
            const existingData = routeInfo.get(id);
            if (existingData) {
              if (type === "loader") {
                existingData.loader = cutArrayToLastN([...existingData.loader, data], 30);
              }
              if (type === "action") {
                existingData.action = cutArrayToLastN([...existingData.action, data], 30);
              }
            } else {
              if (type === "loader") {
                routeInfo.set(id, { loader: [data], action: [] });
              }
              if (type === "action") {
                routeInfo.set(id, { loader: [], action: [data] });
              }
            }
            server.ws.clients.forEach((client) => {
              client.send("route-info", JSON.stringify({ type, data }));
            });
          })
        );

        server.ws.on("connection", (socket) => {
          socket.on("message", (data) => {
            try {
              const json = JSON.parse(data.toString());
              if (json.type === "custom" && "data" in json) {
                if (json.data.type === "open-source") {
                  handleGoToSource(json.data);
                }
              }

              if (json.event === "all-route-info") {
                server.ws.clients.forEach((client) => {
                  client.send(
                    "all-route-info",
                    JSON.stringify({
                      type: "all-route-info",
                      data: Object.fromEntries(routeInfo.entries()),
                    })
                  );
                });
              }
              // eslint-disable-next-line no-empty
            } catch (e) {}
          });
        });
      },
    },

    // Application Runtime Events:
    // - loader, action requests including timing information
    // - document requests (hopefully with timeing information)
    // - file change events

    // Application Static Informations:
    // - routes
    // - loader, action, meta, handle, error boundaries,

    // 1. Remix Powerkit Server will load the remix server build to get the static information
    // 2. Remix Application will send the runtime information to the remix powerkit server

    /*
    * 1. Filter for remix document requests using the build with the route infos
    * 2. Send the request to the remix powerkit server
    * 3. Nice to have: Find a way to get the response object
    */
    {
      enforce: "post",
      name: "remix-powerkit-server",
      apply(config) {
        return config.mode === "development";
      },
      handleHotUpdate({file, timestamp}) {
        // eslint-disable-next-line no-console
        console.log(`${chalk.redBright("[HandleHotUpdate]")}`, file, timestamp)
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url || !req.method || req.url?.includes('remix-dev-tools') || req.url?.match(/\.(css|js|ts|tsx|ico|jpg|jpeg|png|svg)/) || req.url?.match(/^\/@/) ) {
            return next();
          }
          const start = performance.now();
          const url = new URL(req.url, `http://${req.headers.host}`);
          const method = req.method?.toUpperCase();
          let isLoaderRequest = false;
          let isActionRequest = false;
          let isDocumentRequest = false;

          if (url.searchParams.has('_data')) {
            if (method !== 'GET') {
              isActionRequest = true;
            } else {
              isLoaderRequest = true;
            }
          } else if(method === 'GET') {
            isDocumentRequest = true;
          }

          // TODO: Add a proper request id to the request
          // req.headers['x-request-id'] = `${Date.now()}-${Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)}`

          const requestHeaders = req.headers;
          const requestMethod = chalk.yellowBright(method)
          const requestUrl = chalk.yellowBright(decodeURI(url.toString()))
          let requestType = 'Request';
          if (isActionRequest){
            requestType = chalk.redBright('[Action]');
          } else if(isLoaderRequest) {
            requestType = chalk.redBright('[Loader]');
          } else if(isDocumentRequest) {
            requestType = chalk.redBright('[Document]');
          }

          // Request
          // eslint-disable-next-line no-console
          console.log(`${requestType} Request for ${requestMethod} ${requestUrl}`, requestHeaders)

          const originalEnd = res.end;
          // @ts-ignore-next-line
          res.end = (...args) => {
            const responseTime = `${chalk.white(diffInMs(start))}ms`
            const responseHeaders:{[key: string]:undefined|OutgoingHttpHeader} = {}
            for(const [key, value] of Object.entries(res.getHeaders())) {
              responseHeaders[key] = value
            }

            // Response
            // eslint-disable-next-line no-console
            console.log(`${requestType} Response for ${requestMethod} ${requestUrl} - ${responseTime}`, responseHeaders)

            // @ts-ignore-next-line
            return originalEnd.apply(res, args);
          }

          return next();
        });
      },
    },

    {
      name: "remix-development-tools",
      apply(config) {
        return config.mode === "development";
      },
      transform(code, id) {
        // Wraps loaders/actions
        if (id.includes("virtual:server-entry") || id.includes("virtual:remix/server-build")) {
          const updatedCode = [
            `import { augmentLoadersAndActions } from "remix-development-tools/server";`,
            code.replace("export const routes =", "const routeModules ="),
            `export const routes = augmentLoadersAndActions(routeModules);`,
          ].join("\n");

          return updatedCode;
        }
        if (id.includes("root.tsx")) {
          const [, exports] = parse(code);
          const exportNames = exports.map((e) => e.n);
          const hasLinksExport = exportNames.includes("links");
          const lines = code.split("\n");
          const imports = [
            'import { withViteDevTools } from "remix-development-tools";',
            'import rdtStylesheet from "remix-development-tools/index.css?url";',
            'import "remix-development-tools/index.css?inline";',
            plugins.map((plugin) => `import { ${plugin.name} } from "${plugin.path}";`).join("\n"),
          ];

          const augmentedLinksExport = hasLinksExport
            ? `export const links = () => [...linksExport(), { rel: "stylesheet", href: rdtStylesheet }];`
            : `export const links = () => [{ rel: "stylesheet", href: rdtStylesheet }];`;

          const augmentedDefaultExport = `export default withViteDevTools(AppExport, { plugins: [${pluginNames.join(
            ","
          )}] })();`;

          const updatedCode = lines.map((line) => {
            // Handles default export augmentation
            if (line.includes("export default function")) {
              const exportName = line.split("export default function ")[1].split("(")[0].trim();
              const newLine = line.replace(`export default function ${exportName}`, `function AppExport`);
              return newLine;
            } else if (line.includes("export default")) {
              const newline = line.replace("export default", "const AppExport =");
              return newline;
            }
            // Handles links export augmentation
            if (line.includes("export const links")) {
              return line.replace("export const links", "const linksExport");
            }
            if (line.includes("export let links")) {
              return line.replace("export let links", "const linksExport");
            }
            if (line.includes("export function links")) {
              return line.replace("export function links", "const linksExport");
            }
            return line;
          });
          // Returns the new code
          return [...imports, ...updatedCode, augmentedLinksExport, augmentedDefaultExport].join("\n");
        }
      },
    },
  ];
};
