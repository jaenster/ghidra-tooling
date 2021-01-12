# What is this?
This is a simple project that helps me convert and fetch the structures i export out of ghidra to a more sane format for our [hobby projectlink](https://github.com/blizzhackers/Charon). While its specificly designed for Charon, it can be easily modified for your own use cases

# Warning
This is a hacky script I wrote in a day, it's not clean or meant to be. Don't judge my code style by this script ;)

# How to use
Configure `StructureConfig.json` to use the proper fields.

# Export in ghidra
Open in the "Data Type Manager". Make sure you empty the filter field.

Right click on the project and click on the last option; "Export C Header"

Save the `game.exe.h` to the path you setup in StructureConfig.json.

# Run
I prefer to use `yarn`, if you have yarn installed its simply:`yarn run script`

Without yarn you can run it with. But srsly just use yarn. `npm i && node -r ts-node/register ./gameHeaderConverter.ts`

# Live reloading
It will rebuild the entire ghidra files for the Charon project once you
- you edit `ghidra.extensions.cpp` in Charon, this will aut
- export the `game.exe.h` file
- edit the `StructureConfig.json` file
