/**
 * Signs the release variant with the private release key.
 *
 * `expo prebuild` generates an app/build.gradle whose release build type signs
 * with the bundled debug key. That is right for the LAN test build (see
 * app.config.ts) and wrong for the real app: Android only installs an update
 * over an app signed with the same key, so a release accidentally signed with
 * the debug key would break the update path.
 *
 * For the release variant this adds a `release` signing config read from Gradle
 * properties, which build_apk.sh supplies from BuildKit secrets, and makes the
 * build fail if they are missing rather than fall back to the debug key. The
 * key never enters the repository or an image layer.
 *
 * The generated file is matched literally, and the plugin throws if the text
 * it expects is not there: a silent no-op after an SDK upgrade would mean an
 * unsigned or debug-signed release.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING_CONFIGS_ANCHOR = `    signingConfigs {
        debug {`;

const RELEASE_SIGNING_CONFIG = `    signingConfigs {
        release {
            def storeFilePath = findProperty('NAMU_RELEASE_STORE_FILE')
            if (!storeFilePath) {
                throw new GradleException(
                    "The release variant needs the release key: run mobile/build_apk.sh, " +
                    "which passes NAMU_RELEASE_STORE_FILE and its password.")
            }
            storeFile file(storeFilePath)
            storePassword findProperty('NAMU_RELEASE_STORE_PASSWORD')
            keyAlias findProperty('NAMU_RELEASE_KEY_ALIAS') ?: 'namu'
            keyPassword findProperty('NAMU_RELEASE_STORE_PASSWORD')
        }
        debug {`;

const RELEASE_BUILD_TYPE = /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/;

function applyReleaseSigning(contents) {
  if (!contents.includes(SIGNING_CONFIGS_ANCHOR) || !RELEASE_BUILD_TYPE.test(contents)) {
    throw new Error(
      "withReleaseSigning: app/build.gradle no longer has the shape this plugin " +
        "expects. Check the generated file and update the plugin.",
    );
  }
  return contents
    .replace(SIGNING_CONFIGS_ANCHOR, RELEASE_SIGNING_CONFIG)
    .replace(RELEASE_BUILD_TYPE, "$1signingConfig signingConfigs.release");
}

module.exports = (config) =>
  withAppBuildGradle(config, (gradle) => {
    if (process.env.APP_VARIANT === "lan") return gradle;
    gradle.modResults.contents = applyReleaseSigning(gradle.modResults.contents);
    return gradle;
  });

module.exports.applyReleaseSigning = applyReleaseSigning;
