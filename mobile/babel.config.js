module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 moved its Babel plugin into react-native-worklets. Must stay
    // last in the plugins array. (Was "react-native-reanimated/plugin" on RN 0.74.)
    plugins: ["react-native-worklets/plugin"],
  };
};
