import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import * as CmaUsageReader from "./cma/cmaUsageReader.ts";
import * as CmaUsageSource from "./cma/cmaUsageSource.ts";

const reader = CmaUsageReader.layer.pipe(Layer.provide(ProcessRunner.layer));

export const layer = Layer.mergeAll(reader, CmaUsageSource.layer.pipe(Layer.provide(reader)));
