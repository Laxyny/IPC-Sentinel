# Test schema provenance

`sarif-2.1.0.json` is a development-only validation fixture copied from [SchemaStore](https://github.com/SchemaStore/schemastore/blob/master/src/schemas/json/sarif-2.1.0.json) on 12 October 2026. The repository's Apache 2.0 license is retained in `SchemaStore-LICENSE.txt`. The schema is not a scanner dependency and is excluded from npm distribution. Tests validate emitted SARIF against this fixture offline. Update it deliberately and rerun report regression tests.
