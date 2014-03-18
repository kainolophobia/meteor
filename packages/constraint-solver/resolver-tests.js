Tinytest.add("constraint solver - resolver, get exact deps", function (test) {
  // Fat arrow - exact deps
  // Thin arrow - inexact dep or no constraint
  // A => B => C
  //  \    \-> D => E
  //   \->  \-> F
  var resolver = new ConstraintSolver.Resolver();
  var A100 = new ConstraintSolver.UnitVersion("A", "1.0.0", "1.0.0");
  var B100 = new ConstraintSolver.UnitVersion("B", "1.0.0", "1.0.0");
  var C100 = new ConstraintSolver.UnitVersion("C", "1.0.0", "1.0.0");
  var D100 = new ConstraintSolver.UnitVersion("D", "1.1.0", "1.0.0");
  var E100 = new ConstraintSolver.UnitVersion("E", "1.0.0", "1.0.0");
  var F100 = new ConstraintSolver.UnitVersion("F", "1.2.0", "1.0.0");

  resolver.addUnitVersion(A100);
  resolver.addUnitVersion(B100);
  resolver.addUnitVersion(C100);
  resolver.addUnitVersion(D100);
  resolver.addUnitVersion(E100);
  resolver.addUnitVersion(F100);

  A100.addDependency("B");
  A100.addConstraint(resolver.getConstraint("B", "=1.0.0"));
  B100.addDependency("C");
  B100.addConstraint(resolver.getConstraint("C", "=1.0.0"));
  // a dependency w/o a constraint, still should pick it
  B100.addDependency("D");
  D100.addDependency("E");
  D100.addConstraint(resolver.getConstraint("E", "=1.0.0"));
  B100.addDependency("F");
  // a non-exact constraint
  B100.addConstraint(resolver.getConstraint("F", "1.0.0"));
  A100.addDependency("F");
  A100.addConstraint(resolver.getConstraint("F", "1.1.0"));

  test.equal(A100.exactTransitiveDependenciesVersions(resolver), [B100, C100]);
  test.equal(A100.inexactTransitiveDependencies(resolver), ["D", "F"]);
  test.equal(resolver.resolve(["A"]), [A100, B100, C100, D100, E100, F100]);
});

Tinytest.add("constraint solver - resolver, cost function", function (test) {
  var resolver = new ConstraintSolver.Resolver();
  var A100 = new ConstraintSolver.UnitVersion("A", "1.0.0", "1.0.0");
  var A110 = new ConstraintSolver.UnitVersion("A", "1.1.0", "1.0.0");
  var B100 = new ConstraintSolver.UnitVersion("B", "1.0.0", "1.0.0");
  var C100 = new ConstraintSolver.UnitVersion("C", "1.0.0", "1.0.0");
  var C110 = new ConstraintSolver.UnitVersion("C", "1.1.0", "1.0.0");
  var C120 = new ConstraintSolver.UnitVersion("C", "1.2.0", "1.0.0");

  resolver.addUnitVersion(A100);
  resolver.addUnitVersion(A110);
  resolver.addUnitVersion(B100);
  resolver.addUnitVersion(C100);
  resolver.addUnitVersion(C110);
  resolver.addUnitVersion(C120);

  A100.addDependency("C");
  B100.addDependency("A");
  B100.addConstraint(resolver.getConstraint("A", "=1.0.0"));
  B100.addDependency("C");
  B100.addConstraint(resolver.getConstraint("C", "1.1.0"));

  var AOnlySolution = resolver.resolve(["A"]);
  test.equal(AOnlySolution, [A100, C100]);

  var AnBSoultion = resolver.resolve(["A", "B"], [], [], {
    costFunction: function (choices) {
      var C = _.find(choices, function (uv) { return uv.name === "C"; });
      var A = _.find(choices, function (uv) { return uv.name === "A"; });
      return -semver2number(C.version) - semver2number(A.version);
    }
  });

  test.equal(AnBSoultion, [A100, B100, C120]);
});

function semver2number (semverStr) {
  return parseInt(semverStr.replace(/\./g, ""));
}

