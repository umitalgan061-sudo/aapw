# Traversal Review Notes

R001: far stage remains orientation only.
R002: approach stage increases route commitment.
R003: threshold stage exposes entry semantics.
R004: inside stage exposes service context.
R005: service stage remains settlement-owned.
R006: departure stage prioritizes return.
R007: resume stage prioritizes recovery.
R008: gateway lane is always bounded.
R009: market lane is service-aware.
R010: tavern lane is rest-aware.
R011: craft lane is equipment-aware.
R012: farm lane is survival-aware.
R013: military lane is training-aware.
R014: stable lane is travel-aware.
R015: home lane is persistence-aware.
R016: river lane is exploration-aware.
R017: ridge lane is observation-aware.
R018: risk remains normalized.
R019: risk factors remain bounded.
R020: route alternatives remain bounded.
R021: waypoint counts remain bounded.
R022: signal counts remain bounded.
R023: replay frames remain bounded.
R024: milestone count remains stable.
R025: accessibility modes remain stable.
R026: mobile semantics remain equal.
R027: mobile density is reduced.
R028: low motion disables animation hints.
R029: compact mode reduces visible cues.
R030: screen reader mode announces all primary cues.
R031: high contrast emphasizes cue type.
R032: null settlement has a safe fallback.
R033: null player has a safe fallback.
R034: malformed hours remain finite.
R035: malformed fatigue remains finite.
R036: malformed route mode falls back.
R037: malformed lane request falls back.
R038: critical risk can request pause.
R039: warning risk can request slow.
R040: normal risk permits steady pacing.
R041: recovery mode remains read-only.
R042: route selection consumes risk evidence.
R043: route selection consumes stage evidence.
R044: route selection consumes service evidence.
R045: gateway selection remains deterministic.
R046: return selection remains deterministic.
R047: service selection remains deterministic.
R048: exploration selection remains deterministic.
R049: milestone confidence remains normalized.
R050: signal scores remain normalized.
R051: coordinator confidence remains normalized.
R052: replay fingerprint is stable.
R053: plan fingerprint is stable.
R054: risk fingerprint is stable.
R055: route fingerprint is stable.
R056: pacing fingerprint is stable.
R057: signal fingerprint is stable.
R058: accessibility fingerprint is stable.
R059: deep freeze blocks mutation.
R060: ownership flags remain explicit.
R061: no actor spawn is permitted.
R062: no navmesh mutation is permitted.
R063: no road mutation is permitted.
R064: no terrain mutation is permitted.
R065: no gameplay mutation is permitted.
R066: no save mutation is permitted.
R067: no checkpoint mutation is permitted.
R068: no movement mutation is permitted.
R069: no cue mutation is permitted.
R070: no UI mutation is permitted.
R071: campaign runtime remains action authority.
R072: geographic runtime remains spatial authority.
R073: experience remains presentation authority.
R074: traversal remains derived planning evidence.
R075: risk remains advisory evidence.
R076: pacing remains advisory evidence.
R077: route remains advisory evidence.
R078: milestones remain diagnostic evidence.
R079: signals remain presentation evidence.
R080: replay remains diagnostic evidence.
R081: scenario catalogue remains regression data.
R082: matrix documentation remains review data.
R083: test scripts remain executable proof.
R084: CI remains exact-head proof.
R085: scope remains traversal-only.
R086: imports remain local and read-only.
R087: no renderer object is created.
R088: no geometry is created.
R089: no material is created.
R090: no audio node is created.
R091: no particle system is created.
R092: no weather system is created.
R093: no route mesh is created.
R094: no collider is created.
R095: no AI controller is created.
R096: no combat state is created.
R097: no quest ledger is created.
R098: no inventory authority is created.
R099: no save authority is created.
R100: no duplicate world state is created.
R101: deterministic digest uses sorted keys.
R102: deterministic digest uses stable iteration.
R103: deterministic digest never uses wall clock.
R104: traversal never uses hidden randomness.
R105: traversal never schedules timers.
R106: traversal never opens background workers.
R107: traversal never persists on its own.
R108: traversal never pins a chunk.
R109: traversal never changes LOD directly.
R110: traversal only returns LOD hints.
R111: traversal only returns budgets.
R112: traversal only returns scores.
R113: traversal only returns labels.
R114: traversal only returns semantic phases.
R115: traversal only returns evidence.
R116: route mode safe penalizes risk.
R117: route mode direct favors gateway.
R118: route mode service favors services.
R119: route mode return favors gateway.
R120: route mode explore preserves alternatives.
R121: far stage favors landmark discovery.
R122: approach stage favors commitment.
R123: threshold stage favors arrival.
R124: inside stage favors interaction.
R125: service stage favors service.
R126: departure stage favors return.
R127: resume stage favors recovery.
R128: fog reduces confidence.
R129: rain mildly reduces confidence.
R130: snow reduces confidence.
R131: storm strongly reduces confidence.
R132: wind affects risk through weather.
R133: water increases route ambiguity.
R134: slope increases traversal pressure.
R135: distance increases exposure.
R136: fatigue increases recovery preference.
R137: cold increases shelter preference.
R138: navigation weakness increases observation preference.
R139: gateway blocking suppresses entry.
R140: defeated state fails closed.
R141: mobile keeps semantic stages.
R142: mobile keeps semantic lanes.
R143: mobile keeps semantic signals.
R144: mobile lowers waypoint budget.
R145: mobile lowers signal budget.
R146: mobile preserves deterministic ordering.
R147: standard accessibility preserves defaults.
R148: high contrast preserves semantics.
R149: low motion preserves semantics.
R150: screen reader preserves semantics.
R151: compact preserves semantics.
R152: milestone recovery remains safe.
R153: replay stores diagnostic frame only.
R154: replay input is scalar-normalized.
R155: replay keeps newest frames.
R156: signals keep newest bounded result.
R157: primary signals remain capped.
R158: alternatives remain capped.
R159: factors remain capped.
R160: recommendations remain capped.
R161: waypoints remain capped.
R162: lanes remain capped.
R163: milestones remain capped.
R164: scenario identities remain unique.
R165: fingerprints remain compact.
R166: validators return error arrays.
R167: validators return finite values.
R168: validators never throw for plain objects.
R169: selection helpers accept malformed plans safely.
R170: summaries remain compact.
R171: public APIs expose version numbers.
R172: public APIs expose bounded vocabularies.
R173: public APIs expose function names.
R174: public APIs remain immutable.
R175: review scope excludes unrelated systems.
R176: review scope excludes renderer ownership.
R177: review scope excludes editor ownership.
R178: review scope excludes asset authoring.
R179: review scope excludes persistence ownership.
R180: review scope excludes NPC ownership.
R181: review scope excludes combat ownership.
R182: review scope excludes quest ownership.
R183: review scope excludes economy ownership.
R184: review scope excludes terrain ownership.
R185: review scope excludes hydrology ownership.
R186: review scope excludes road ownership.
R187: review scope excludes material ownership.
R188: review scope excludes model ownership.
R189: review scope excludes camera ownership.
R190: review scope excludes audio ownership.
R191: acceptance baseline uses canonical settlement input.
R192: acceptance mobile uses same settlement input.
R193: acceptance threshold checks entry.
R194: acceptance inside checks service.
R195: acceptance departure checks return.
R196: acceptance fog checks caution.
R197: acceptance snow checks caution.
R198: acceptance storm checks pause potential.
R199: acceptance water checks observation.
R200: acceptance steep checks slowing.
R201: acceptance null checks safety.
R202: acceptance malformed numeric checks safety.
R203: acceptance duplicate input checks determinism.
R204: acceptance freeze checks immutability.
R205: acceptance scenario checks cardinality.
R206: acceptance scenario checks uniqueness.
R207: acceptance route checks bounded alternatives.
R208: acceptance signal checks primary cap.
R209: acceptance replay checks frame cap.
R210: acceptance accessibility checks UI bounds.
R211: review complete for lane semantics.
R212: review complete for route semantics.
R213: review complete for risk semantics.
R214: review complete for pacing semantics.
R215: review complete for milestone semantics.
R216: review complete for signal semantics.
R217: review complete for replay semantics.
R218: review complete for accessibility semantics.
R219: review complete for coordinator semantics.
R220: review complete for ownership semantics.
R221: review complete for numeric safety.
R222: review complete for null safety.
R223: review complete for mobile behavior.
R224: review complete for deterministic behavior.
R225: review complete for scope discipline.
R226: review complete for CI integration.
R227: review complete for documentation.
R228: review complete for test coverage.
R229: review complete for merge readiness.
R230: final review status is traversal-only.
R231: exact-head workflow covers runtime syntax.
R232: exact-head workflow covers acceptance tests.
R233: exact-head workflow covers regression tests.
R234: exact-head workflow covers boundary tests.
R235: exact-head workflow covers API tests.
R236: exact-head workflow checks deterministic guards.
R237: exact-head workflow checks source scope.
R238: exact-head workflow exports proof metadata.
R239: exact-head workflow keeps permissions read-only.
R240: merge target is the current main branch.
