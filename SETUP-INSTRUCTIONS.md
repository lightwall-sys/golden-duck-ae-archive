# One-time setup

1. Extract the downloaded ZIP on your computer.
2. Open https://github.com/lightwall-sys/golden-duck-ae-archive
3. Click **Add file** → **Upload files**.
4. Drag every file and folder from inside the extracted package folder into the upload area.
5. Use commit message: `Install automatic Authors Electric archive`.
6. Commit directly to `main`.
7. Open **Settings** → **Pages**.
8. Under **Build and deployment**, set **Source** to **GitHub Actions**.
9. Open the **Actions** tab.
10. Select **Update Authors Electric archive**.
11. Click **Run workflow**, then click the green **Run workflow** button.
12. Wait for the run to finish with a green tick. The first run can take several minutes because it creates the historical copies and downloads images.
13. Open **Settings** → **Pages** and click **Visit site**. The expected address is https://lightwall-sys.github.io/golden-duck-ae-archive/

Do not delete the old Golden Duck `/authors-electric` page until the first run has completed successfully and the generated archive has been checked.
