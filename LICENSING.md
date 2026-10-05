# Licensing

Original Bambi Local project code is licensed under **GNU Affero General Public License version 3 only (`AGPL-3.0-only`)**. The complete standard license is in [LICENSE](LICENSE). Copyright attribution uses the maintainer's public pseudonym, **BambiOS**.

## Free use, including commercial use

You may use, study, modify and share the AGPL-covered code, including for a business or a paid service, under the AGPL's terms. You do not owe the maintainer a fee merely because you earn money with it. Forks and competing services are permitted when they comply with the applicable licenses.

Redistributing covered software carries requirements concerning licensing, notices and Corresponding Source. If you modify the covered program and users interact with that modified version over a network, AGPL section 13 requires a prominent offer of its Corresponding Source to those users. The license determines the scope of that source; this paragraph is a guide, not a replacement for its terms. It does not require publication of every unrelated private project.

These permissions also apply to recipients of an AGPL-licensed private beta. A private repository or invitation does not add a prohibition on redistribution or commercial use. Already granted AGPL rights cannot simply be withdrawn from compliant recipients by changing the license of a later release.

## Separately negotiated commercial permissions

The maintainer may offer a separate written agreement when you need permissions beyond the AGPL grant, for example distributing a covered combined product without the required AGPL source disclosure. Whether a particular integration creates such obligations depends on what you combine and distribute; proprietary software or paid hosting does not automatically require purchasing a license.

No proprietary license is granted by this document, a source header, a payment or an unanswered request. Its scope, contracting parties, price and any support must be agreed separately. The maintainer can grant exceptions only for rights they own or have permission to sublicense. Third-party obligations still apply.

For licensing inquiries, contact [BambiOS on GitHub](https://github.com/BambiOS) through the available profile contact route. The GitHub account's numeric ID is **337824705**; account renames do not change this identifier. If no private contact route is listed, open a licensing inquiry in this repository without confidential information. A public pseudonym is attribution, not a promise of anonymous contracting.

## Third-party scope

Existing license notices override the default project license for the identified third-party components. In particular:

| Component | Retained terms and provenance |
| --- | --- |
| Pinned `packages/content/stable-2.0/` source/assets and `packages/content/upstream-originals/`, including the locally modified Classic prompt | [STABLE-2.0 MIT notice](docs/LICENSE.stable2), [provenance and modifications](docs/STABLE_CONTENT.md) |
| Adapted `packages/visuals/stable-renderer.ts` | STABLE-2.0 MIT notice and provenance above |
| Kokoro-derived `voices/bambi_classic` embedding | [Apache-2.0 model license](docs/licenses/KOKORO-APACHE-2.0.txt) and [modification notice](docs/licenses/KOKORO-ATTRIBUTION.md) |
| Public sound assets | Per-asset declarations and provenance in [audio notices](docs/LOCAL_AUDIO_LICENSES.md), including CC0 assets |
| Other audio/model, VAD and device dependencies | [Audio notices](docs/LOCAL_AUDIO_LICENSES.md), [VAD/ONNX notices](docs/licenses/), [device provenance](docs/DEVICES.md) and their upstream terms |

Downloaded models, dependencies and runtime environments retain their own licenses. In particular, GPL-covered speech components are not made proprietary by a commercial exception for original project code. Separating services does not establish that every redistribution is exempt from their obligations. Preserve all applicable license and attribution files when distributing bundles.

Project licensing does not grant rights to external media, user imports, trademarks or provider names. Private recordings and unreviewed voice exports are excluded from the source distribution.

## Contributions

The [CLA](CLA.md) grants nonexclusive permissions for the maintainer to offer contributed work under AGPL and separate licenses. Contributors retain copyright. Read [CONTRIBUTING.md](CONTRIBUTING.md) for explicit acceptance and the review process; submitting a PR alone is not treated as signing the CLA. Previously imported third-party work is not covered by this grant.
