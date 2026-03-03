import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SolverMainPage } from './solver-main-page';

describe('SolverMainPage', () => {
  let component: SolverMainPage;
  let fixture: ComponentFixture<SolverMainPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SolverMainPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SolverMainPage);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
