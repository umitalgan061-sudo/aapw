import { KeyboardInput } from './input.ts';
import { TouchJoystick } from './ui/touchJoystick.ts';
import { InteractionPrompt } from './ui/interactionPrompt.js';
import { DialogueBox } from './ui/dialogueBox.js';
import { WorldEventToast } from './ui/worldEventToast.js';
import { HealthBar } from './ui/healthBar.js';
import { ControlsHelp } from './ui/controlsHelp.js';
import { PauseMenu } from './ui/pauseMenu.ts';
import { createAudioManager, readStoredMuted } from './audio/audioManager.js';
import { SettlementCompass } from './ui/settlementCompass.js';
import { SettlementDiscovery } from './ui/settlementDiscovery.js';
import { DayNightClock } from './ui/dayNightClock.js';
import { createPlayer } from './gameplay/player.ts';
import { createHealthState } from './gameplay/health.js';
import { spawnLivingWorld } from './gameplay/livingWorldSpawner.ts';
import { createInteractionController } from './gameplay/interaction.ts';
import { focusSunShadow, applyShadowRoles } from './renderQuality.ts';
import { createWorldEventSystem } from './gameplay/worldEvents.ts';
import { updateWater, disposeWater } from './world/water.ts';
import { createWeatherSystem } from './world/weather.ts';
import { disposeRiverMesh, disposeWaterfallMesh, updateFlowAnimation } from './world/rivers.ts';
import { disposeSettlements, disposeRealCastleModels, spawnRealCastleModels, mapToWorldXZ } from './world/settlements.ts';
import { disposeRoadNetwork } from './world/roads.ts';
import { disposeVegetation } from './world/vegetation.js';
import { disposeVillages } from './world/villages.ts';
import { disposeIceLandmarks } from './world/iceLandmarks.js';
// Run 371 — the mobile spawn-anchored vegetation disc itself (previously inlined here, using
// `createVegetation`/`CHUNK_CONFIG` directly) moved to `mobileSpawnVegetation.js` to keep this file
// under the 600-line cap; see that module's own doc comment for the "why".
import { spawnMobileVegetationDisc } from './mobileSpawnVegetation.js';
import { resolveCameraCollision } from './camera.ts';
import { updateAuroraSky, disposeAuroraSky } from './sky.js';
import { updateStarfield, disposeStarfield } from './stars.js';
import { updateDayNightLighting, disposeDayNightLighting } from './lighting.js';
import { updateFog } from './fog.js';
import { updateMobileVegetationDistanceCullingRun141 } from './world/mobileVegetationCulling.js';