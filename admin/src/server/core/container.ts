import { createContainer, asClass, asValue, asFunction, type AwilixContainer } from "awilix"
import type { MikroORM } from "@mikro-orm/core"
import type { MpflowConfig } from "../../../mpflow.config.js"

export interface AppContainer {
  orm: MikroORM
  config: MpflowConfig
  // Services are registered dynamically by modules
  [key: string]: any
}

let container: AwilixContainer<AppContainer> | null = null

export function createAppContainer(orm: MikroORM, config: MpflowConfig): AwilixContainer<AppContainer> {
  container = createContainer<AppContainer>()

  container.register({
    orm: asValue(orm),
    config: asValue(config),
  })

  return container
}

export function getContainer(): AwilixContainer<AppContainer> {
  if (!container) throw new Error("Container not initialized")
  return container
}

export { asClass, asValue, asFunction }
