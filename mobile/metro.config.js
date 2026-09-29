const { getSentryExpoConfig } = require("@sentry/react-native/metro");

// Produce matching runtime/source-map debug IDs without adding release globals,
// replay code, component annotations, or a development source-context endpoint.
module.exports = getSentryExpoConfig(__dirname, {
  injectReleaseForWeb: false,
  includeWebReplay: false,
  annotateReactComponents: false,
  enableSourceContextInDevelopment: false,
});
