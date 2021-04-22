const { Octokit } = require('@octokit/core')
const Git = require('nodegit')
const fs = require('fs')
const rmfr = require('rmfr');
const path = require('path')
const unzipper = require('unzipper')
const request = require('request')
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');

const octokit = new Octokit();

(async function () {
  const repo = await Git.Repository.open(path.resolve(__dirname, "../../.git"))
  const repoTags = await Git.Tag.list(repo)
  const releases = await octokit.request('GET /repos/{owner}/{repo}/releases', {
    owner: 'be5invis',
    repo: 'Iosevka'
  })
  // Releases are sorted by time, we reverse the order to make the latest release the latest commit in the repository
  for (const release of releases.data.filter(r => !r.draft && !r.prerelease).reverse()) {
    console.log('\n', release.tag_name, '=============================\n\n')
    if (!repoTags.includes(release.tag_name)) {
      const zipAssets = release.assets
        .filter(a => !a.name.includes('fixed') && !a.name.includes('term')) // remove fixed and term fonts
        .filter(a => !/[sS]{2}[0-9]{2,}/g.test(a.name)) // remove ss fonts
        .filter(a => a.content_type === 'application/zip' && a.name.includes('webfont')) // only include webfonts
      let downloads = []
      for (const asset of zipAssets) {
        // Determine directory name
        const dirName = asset.name.replace('webfont-', '').replace(`-${release.tag_name.substr(1)}.zip`, '')
        // if (fs.existsSync(`../../dist/${dirName}`)) {
        //   continue
        // }
        // Download zip and extract
        downloads.push(
          rmfr('../../dist', { glob: true }).catch().then(() => {
            return unzipper.Open.url(request, asset.browser_download_url).then(zip => {
              console.log(dirName)
              return zip.extract({
                path: `../../dist/${dirName}`,
                concurrency: 5
              })
            })
          })
        )
      }
      await Promise.all(downloads).then(() => {
        // Minify css
        return minify({
          compressor: cleanCSS,
          input: `../../dist/*/*.css`,
          output: '$1.min.css',
          replaceInPlace: true,
          callback: function (err, min) { }
        });
      })
      downloads = []
      // Commit changes
      const msg = `Add ${release.name}`
      const index = await repo.refreshIndex()
      await index.addAll('dist/**');
      await index.write();
      const oid = await index.writeTree();
      const parent = await repo.getHeadCommit();
      const author = Git.Signature.now("Ayman Bagabas", "ayman.bagabas@gmail.com");
      const committer = author
      const commitId = await repo.createCommit("HEAD", author, committer, msg, oid, [parent]);
      console.log(`Commit ID: ${commitId}`)
      await repo.refreshIndex()
      await repo.refreshReferences()
      // Tag release
      await Git.Tag.create(repo, release.tag_name, await repo.getHeadCommit(), author, msg, 1)
      console.log(`Tag ${release.tag_name} created`)
    }
  }
})().catch(err => {
  console.log(err)
  process.exit(1)
})
