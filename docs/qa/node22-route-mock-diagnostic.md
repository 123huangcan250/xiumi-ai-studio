# Node22 route mock diagnostic (2026-11-14)

Exact upstream candidate `4ad308b`, CI run43575192256 Node22 job132387796566 failed7 assertions in appRoutesReview: imported chatJson/discoverModels/testConnection were real functions, while safeFetch remained mocked. Same local Node22.19 full591 and isolated10 tests passed. No business assertion has been removed and no retry is presented as a fix.

Source inspection rules out resetAllMocks turning mocks into original functions, and settings/net importOriginal do not themselves import ai. The app -> aiModels -> ai cycle exists but is not sufficient proof of the cause: the test static ai import should already resolve the full mock factory. No deterministic local reproducer has yet been established.

This change records only boolean mock identity, reference equality and a hoisted factory invocation count at static import and before/after importing app. It fails before starting HTTP requests if provider mocking is invalid. It does not print profiles, tokens, function bodies or provider responses. The original10 route behavior assertions remain.

Local Node22 diagnostic suite10/10 passed; this is diagnostic instrumentation, not a claim that the intermittent CI loader issue is fixed. The next exact CI must determine whether the factory was skipped, module identity differed, or the binding changed during app import.

The test setup also binds both supported data-directory variables to the same private temporary fixture. This is a separate isolation safeguard against an inherited packaged-app override, not an explanation of the CI mock-identity failure.
