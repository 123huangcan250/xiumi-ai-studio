# Node22 route mock diagnostic (2026-11-14)

Exact upstream candidate `4ad308b`, CI run43575192256 Node22 job132387796566 failed7 assertions in appRoutesReview: imported chatJson/discoverModels/testConnection were real functions, while safeFetch remained mocked. Same local Node22.19 full591 and isolated10 tests passed. No business assertion has been removed and no retry is presented as a fix.

Source inspection rules out resetAllMocks turning mocks into original functions, and settings/net importOriginal do not themselves import ai. The app -> aiModels -> ai cycle exists but is not sufficient proof of the cause: the test static ai import should already resolve the full mock factory. No deterministic local reproducer has yet been established.

This change records only boolean mock identity, reference equality and a hoisted factory invocation count at static import and before/after importing app. It fails before starting HTTP requests if provider mocking is invalid. It does not print profiles, tokens, function bodies or provider responses. The original10 route behavior assertions remain.

Local Node22 diagnostic suite10/10 passed; this is diagnostic instrumentation, not a claim that the intermittent CI loader issue is fixed. The next exact CI must determine whether the factory was skipped, module identity differed, or the binding changed during app import.

The test setup also binds both supported data-directory variables to the same private temporary fixture. This is a separate isolation safeguard against an inherited packaged-app override, not an explanation of the CI mock-identity failure.

## Follow-up evidence and bounded loading change (0967640)

CI run 43576729217 reversed the Node outcome: Node22 passed, Node24 failed. The failing diagnostic reported factoryCalls=1, all three staticImport/beforeApp/afterApp isMock flags false, and all three references unequal to importMock. Thus the incorrect static binding predates app import. A fixed Node-version incompatibility, resetAllMocks, and the app cycle alone do not explain this evidence. The deeper intermittent loader/cache trigger remains unproven.

The route fixture now removes all server value static imports. beforeAll resets the evaluated module registry, registers explicit doMock factories for ai, net and settings, then sequentially dynamically imports these modules before app. Real dynamic exports must equal the fixture's exact factory handles, both before and after app loading. HTTP assertions still verify that app invokes those handles; importMock is not used to substitute a mock handle for an incorrectly loaded real dependency. Unconfigured provider and network calls throw locally.

Identity risk: resetModules does not re-evaluate existing top-level imports. Retaining static safeFetch while app receives a newly evaluated net instance would split setup/assertions from the route dependency. net is therefore dynamically loaded too. settings has no retained static value import, but its factory is explicitly re-registered and resolveDraftProfile identity checked, avoiding reliance on a prior cached partial mock. Type-only imports do not load these modules. Existing temporary DATA_DIR/XIUMI_DATA_DIR isolation and all 10 route behavior tests remain; no timeouts, retries or production code change.

Official API contracts: [vi.doMock](https://vitest.dev/api/vi#vi-domock) applies to subsequent dynamic imports; [vi.resetModules](https://vitest.dev/api/vi#vi-resetmodules) clears evaluated module cache, does not reevaluate top-level imports, and does not clear mock registry. Explicit doMock registrations replace this fixture's factories after reset. This is an evidence-directed loading fix candidate, not proof of a specific Vitest internal bug. Validation is pending; no new test pass is claimed in this revision.
