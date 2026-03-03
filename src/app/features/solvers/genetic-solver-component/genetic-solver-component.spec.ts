import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GeneticSolverComponent } from './genetic-solver-component';

describe('GeneticSolverComponent', () => {
  let component: GeneticSolverComponent;
  let fixture: ComponentFixture<GeneticSolverComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GeneticSolverComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(GeneticSolverComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
