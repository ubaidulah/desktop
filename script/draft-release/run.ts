import { sort as semverSort, SemVer } from 'semver'

import { spawn } from '../changelog/spawn'
import { getLogLines } from '../changelog/git'
import {
  convertToChangelogFormat,
  getChangelogEntriesSince,
} from '../changelog/parser'

import { Channel } from './channel'
import { getNextVersionNumber } from './version'

const jsonStringify: (obj: any) => string = require('json-pretty')

/**
 * Returns the latest release tag, according to git and semver
 * (ignores test releases)
 *
 * @param options there's only one option `excludeBetaReleases`,
 *                which is a boolean
 */
async function getLatestRelease(options: {
  excludeBetaReleases: boolean
}): Promise<string> {
  const allTags = await spawn('git', ['tag'])
  let releaseTags = allTags
    .split('\n')
    .filter(tag => tag.startsWith('release-'))
    .filter(tag => !tag.includes('-linux'))
    .filter(tag => !tag.includes('-test'))

  if (options.excludeBetaReleases) {
    releaseTags = releaseTags.filter(tag => !tag.includes('-beta'))
  }

  const releaseVersions = releaseTags.map(tag => tag.substr(8))

  const sortedTags = semverSort(releaseVersions)
  const latestTag = sortedTags[sortedTags.length - 1]

  return latestTag instanceof SemVer ? latestTag.raw : latestTag
}

/** Converts a string to Channel type if possible */
function parseChannel(arg: string): Channel {
  if (arg === 'production' || arg === 'beta' || arg === 'test') {
    return arg
  }

  throw new Error(`An invalid channel ${arg} has been provided`)
}

/**
 * Prints out next steps to the console
 *
 * @param nextVersion version for the next release
 * @param entries release notes for the next release
 */
function printInstructions(nextVersion: string, entries: Array<string>) {
  const object: any = {}
  object[nextVersion] = entries.sort()

  const steps = [
    `Update the app/package.json 'version' to '${nextVersion}' (make sure this aligns with semver format of 'major.minor.patch')`,
    `Concatenate this to the beginning of the 'releases' element in the changelog.json as a starting point:\n${jsonStringify(
      object
    )}\n`,
    'Revise the release notes according to https://github.com/desktop/desktop/blob/development/docs/process/writing-release-notes.md',
    'Commit the changes (on development or as new branch) and push them to GitHub',
    'Read this to perform the release: https://github.com/desktop/desktop/blob/development/docs/process/releasing-updates.md',
  ]

  console.log(steps.map((value, index) => `${index + 1}. ${value}`).join('\n'))
}

export async function run(args: ReadonlyArray<string>): Promise<void> {
  try {
    await spawn('git', ['diff-index', '--quiet', 'HEAD'])
  } catch {
    throw new Error(
      `There are uncommitted changes in the working directory. Aborting...`
    )
  }
  if (args.length === 0) {
    throw new Error(
      `You have not specified a channel to draft this release for. Choose one of 'production' or 'beta'`
    )
  }

  const channel = parseChannel(args[0])
  const excludeBetaReleases = channel === 'production'
  const previousVersion = await getLatestRelease({ excludeBetaReleases })
  const nextVersion = getNextVersionNumber(previousVersion, channel)

  const lines = await getLogLines(`release-${previousVersion}`)
  const noChangesFound = lines.every(l => l.trim().length === 0)

  if (noChangesFound) {
    // print instructions with no changelog included
    printInstructions(nextVersion, [])
  } else {
    const changelogEntries = await convertToChangelogFormat(lines)

    console.log("Here's what you should do next:\n")

    if (channel === 'production') {
      // make sure we only include entries since the latest production release
      const existingChangelog = getChangelogEntriesSince(previousVersion)
      const entries = [...existingChangelog]
      printInstructions(nextVersion, entries)
    } else if (channel === 'beta') {
      const entries = [...changelogEntries]
      printInstructions(nextVersion, entries)
    }
  }
}
