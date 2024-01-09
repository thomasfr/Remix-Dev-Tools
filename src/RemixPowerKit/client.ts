// import { hc } from "hono/client"
// @ts-ignore-next-line Once Remix-PowerKit-UI-Server is part of the monorepo, this will be fixed
// import type { AppType } from "../../../Remix-PowerKit-ui-server/src/index.js"

import { httpTransport, emitterFor, CloudEvent } from "cloudevents"

const serverUrl = process.env.REMIX_POWERKIT_HOST || "http://localhost:4321"

// type RemixPowerKitType = ReturnType<typeof hc<AppType>>
// let client: RemixPowerKitType | undefined

// export function getClient(): RemixPowerKitType {
//     if (!client) {
//         client = hc<AppType>(serverUrl)
//     }
//     return client
// }

const emit = emitterFor(httpTransport(`${serverUrl}/events`))
export enum EventTypes {
    "START" = "Start",
    "STOP" = "Stop",
    "RESTART" = "Restart",
    "REQUEST" = "GenericRequest",
    "RESPONSE" = "GenericResponse",
    "DOCUMENT_REQUEST" = "DocumentRequest",
    "DOCUMENT_RESPONSE" = "DocumentResponse",
    "LOADER_REQUEST" = "LoaderRequest",
    "LOADER_RESPONSE" = "LoaderResponse",
    "ACTION_REQUEST" = "ActionRequest",
    "ACTION_RESPONSE" = "ActionResponse",
    "ERROR" = "Error",
}
interface EventContext {
    type: EventTypes
    source: string
    subject?: string
    data?: Record<string, unknown>
    time?: Date
}
export async function send(eventContext: EventContext) {
    // TODO: Branch on EventType and check that the data is valid for that type
    const event = new CloudEvent({
        type: `RemixPowerKit.${eventContext.type}.v1`,
        source: eventContext.source,
        subject: eventContext.subject,
        time: eventContext.time?.toISOString() || new Date().toISOString(),
        data: eventContext.data,
    })
    return emit(event)
    .catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err, event.toJSON())
    })

}
