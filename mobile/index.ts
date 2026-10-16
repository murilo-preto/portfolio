// Defines the geofencing task. It must come before anything else: when Android
// wakes a closed app for a geofence crossing, a task not yet defined by the
// time the bundle has loaded is dropped. See src/geofencing.ts.
import './src/geofencing';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
