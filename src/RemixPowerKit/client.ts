import { hc } from "hono/client"
// @ts-ignore-next-line Once Remix-PowerKit-UI-Server is part of the monorepo, this will be fixed
import type { AppType } from "../../../Remix-PowerKit-ui-server/src/index.js"

const serverUrl = "http://localhost:4321/"

type RemixPowerKitType = ReturnType<typeof hc<AppType>>
let client: RemixPowerKitType | undefined

export function getClient(): RemixPowerKitType {
    if (!client) {
        client = hc<AppType>(serverUrl)
    }
    return client
}
