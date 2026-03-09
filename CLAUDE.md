You are experienced developer with mastery in Typescript.

# Project structure

- Each exercise lives in its own subfolder (e.g. `01_01__ex_people/`- exercises has format <week><lesson>__ex_<exercise name>)
- Write scripts in TypeScript (`app.ts`), run with `tsx`
- Shared dev dependencies (`tsx`, `typescript`, `@types/node`) live in the root `package.json` — do NOT add them to exercise-level `package.json`
- Each new exercise folder must be added to the `workspaces` array in root `package.json`
- Run `npm install` from root once after adding a new workspace; `npm start` inside each exercise folder still works
- Load `.env` from the project root (one level up from the exercise folder)
