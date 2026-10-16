/**
 * The plugin's text rewrite, against the shape `expo prebuild` generates for
 * SDK 57. If an SDK upgrade changes that shape, the plugin must fail loudly,
 * never produce a release signed with the debug key.
 */
const { applyReleaseSigning } = require("../../plugins/withReleaseSigning");

const GENERATED = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}`;

it("signs the release build type with the release key", () => {
  const out: string = applyReleaseSigning(GENERATED);

  expect(out).toContain("release {\n            def storeFilePath = findProperty('NAMU_RELEASE_STORE_FILE')");
  const releaseBlock = out.slice(out.indexOf("buildTypes"));
  expect(releaseBlock).toMatch(/release \{[\s\S]*signingConfig signingConfigs\.release/);
});

it("leaves the debug build type on the debug key", () => {
  const out: string = applyReleaseSigning(GENERATED);
  const debugBuildType = out.slice(out.indexOf("buildTypes"), out.indexOf("release {", out.indexOf("buildTypes")));
  expect(debugBuildType).toContain("signingConfig signingConfigs.debug");
});

it("fails the build rather than fall back when the key is missing", () => {
  expect(applyReleaseSigning(GENERATED)).toContain("throw new GradleException");
});

it("refuses a build.gradle of an unexpected shape", () => {
  expect(() => applyReleaseSigning("android { }")).toThrow(/no longer has the shape/);
});
